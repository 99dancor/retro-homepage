-- Farming Hub Export
--
-- Schreibt bei jedem Speichern die Kartendaten, die der Farming Hub der Website braucht, in den Spielstand-Ordner
-- (farmingHubExport.xml neben careerSavegame.xml). Der Hub holt die Datei per FTP wie die anderen Spielstand-Dateien.
--
--   Felder       Umriss jedes Felds (Ecken in Weltkoordinaten), auch Felder, die noch kein Acker sind
--   Grundstücke  Nummer, Mitte, Größe, Preis, Besitzer und die Grundstückskarte (wem gehört welcher Fleck)
--   Gebäude      Position aller Verkaufsstellen, Ladestationen, Tankstellen, Händler und Produktionen, bei Produktionen
--                die Rezepte, welche gerade laufen und was im Lager liegt (Füllstand und Platz)
--   Waren        jede Ware mit ihrem Namen in der Sprache des Spiels und dem Grundpreis
--   Früchte      jede Frucht mit Wachstumsstufen, wann sie gesät und geerntet wird, Ertrag, Saatgut und Kartenfarbe
--   Katalog      alle Produktionen, die man im Shop kaufen kann, mit Preis, Rezepten und Lager
--   Tiere        (ab 2.4) alle Tierarten: Futter, Wasser, Stroh, Milch, Wolle, Mist je Alter, Preise, Nachwuchs, Futtergruppen
--                mit Anteil an der Leistung, Mischungen, Ställe aus dem Shop; bei jedem Stall Tiere, Futter und Füllstände
--
-- Alles kommt aus dem laufenden Spiel, so wie es die Karte und der Shop im Spiel auch anzeigen. Die Mod ändert nichts am
-- Spielstand. Im Mehrspieler schreibt nur der Server. Teile, die eine Spielversion anders benennt, fehlen dann einfach in
-- der Datei, der Rest wird trotzdem geschrieben.
--
-- Konsole (Taste ~ oder ^): hubExport schreibt die Datei sofort.

FarmingHubExport = {}
FarmingHubExport.VERSION = 2
FarmingHubExport.FILENAME = "farmingHubExport.xml"
FarmingHubExport.MAX_GRID = 1024
FarmingHubExport.modName = g_currentModName

local function num(v, digits)
    return string.format("%." .. (digits or 1) .. "f", v or 0)
end

local function fillName(index)
    if index == nil or g_fillTypeManager == nil then
        return nil
    end
    return g_fillTypeManager:getFillTypeNameByIndex(index)
end

-- Schlüssel einer Tabelle { [fillTypeIndex] = true } als Namen, durch Leerzeichen getrennt
local function fillList(map)
    if type(map) ~= "table" then
        return ""
    end
    local names = {}
    for index, on in pairs(map) do
        if on and type(index) == "number" then
            local name = fillName(index)
            if name ~= nil and name ~= "UNKNOWN" then
                table.insert(names, name)
            end
        end
    end
    table.sort(names)
    return table.concat(names, " ")
end

local function nodePosition(node)
    if node == nil or node == 0 or not entityExists(node) then
        return nil
    end
    local x, _, z = getWorldTranslation(node)
    return x, z
end

local function try(what, fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then
        Logging.warning("FarmingHubExport: %s: %s", what, tostring(err))
    end
    return ok
end

-- Erste Methode eines Objekts, die es gibt und die nicht scheitert (Spielversionen benennen manches anders)
local function call(obj, names, ...)
    if obj == nil then
        return nil
    end
    for _, n in ipairs(names) do
        if type(obj[n]) == "function" then
            local ok, v = pcall(obj[n], obj, ...)
            if ok then
                return v
            end
        end
    end
    return nil
end

local function text(s, env)
    if s == nil then
        return nil
    end
    local v = tostring(s)
    if g_i18n ~= nil and type(s) == "string" and string.sub(s, 1, 6) == "$l10n_" then
        local ok, t = pcall(g_i18n.convertText, g_i18n, s, env)
        if ok and t ~= nil then
            v = t
        end
    end
    -- Platzhalter wie „%s (%s)“ füllt das Spiel erst beim Anzeigen: dann lieber kein Name
    if string.find(v, "%%s") then
        return nil
    end
    return v
end

-- ---------- Felder ----------
function FarmingHubExport:writeFields(xml)
    local fields = g_fieldManager.fields or (g_fieldManager.getFields ~= nil and g_fieldManager:getFields()) or {}
    local n = 0
    for i, field in ipairs(fields) do
        local nodes = field.polygonPoints
        if (nodes == nil or #nodes == 0) and field.getPolygonPoints ~= nil then
            nodes = field:getPolygonPoints()
        end
        local pts = {}
        for _, node in ipairs(nodes or {}) do
            local x, z = nodePosition(node)
            if x ~= nil then
                table.insert(pts, num(x) .. "," .. num(z))
            end
        end
        if #pts >= 3 then
            local key = string.format("farmingHubExport.fields.field(%d)", n)
            local id = (field.getId ~= nil and field:getId()) or field.fieldId or i
            xml:setInt(key .. "#id", id)
            if field.farmland ~= nil then
                xml:setInt(key .. "#farmland", field.farmland.id)
            end
            xml:setString(key .. "#areaHa", num(field.areaHa, 3))
            if field.posX ~= nil then
                xml:setString(key .. "#x", num(field.posX))
                xml:setString(key .. "#z", num(field.posZ))
            end
            xml:setString(key .. "#pts", table.concat(pts, " "))
            n = n + 1
        end
    end
    return n
end

-- ---------- Grundstücke ----------
-- Die Grundstückskarte zeilenweise als Läufe „Nummer*Länge“. Ändert sich nicht, solange die Karte läuft: einmal rechnen.
function FarmingHubExport:farmlandGrid()
    if self.grid ~= nil then
        return self.grid
    end
    local fm = g_farmlandManager
    local map = fm.localMap or (fm.getLocalMap ~= nil and fm:getLocalMap())
    if map == nil then
        return nil
    end
    local w, h = fm.localMapWidth, fm.localMapHeight
    if (w or 0) <= 0 then
        w, h = getBitVectorMapSize(map)
    end
    local bits = fm.numberOfBits or getBitVectorMapNumChannels(map)
    local size = math.min(w, h, FarmingHubExport.MAX_GRID)
    local rows = {}
    for row = 0, size - 1 do
        local y = math.floor((row + 0.5) * h / size)
        local runs, last, count = {}, nil, 0
        for col = 0, size - 1 do
            local v = getBitVectorMapPoint(map, math.floor((col + 0.5) * w / size), y, 0, bits)
            if v == last then
                count = count + 1
            else
                if last ~= nil then
                    table.insert(runs, last .. "*" .. count)
                end
                last, count = v, 1
            end
        end
        table.insert(runs, last .. "*" .. count)
        rows[row + 1] = table.concat(runs, " ")
    end
    self.grid = { size = size, rows = rows }
    return self.grid
end

function FarmingHubExport:writeFarmlands(xml)
    local fm = g_farmlandManager
    local ids = {}
    for id in pairs(fm.farmlands or {}) do
        table.insert(ids, id)
    end
    table.sort(ids)
    for n, id in ipairs(ids) do
        local f = fm.farmlands[id]
        local key = string.format("farmingHubExport.farmlands.farmland(%d)", n - 1)
        xml:setInt(key .. "#id", id)
        xml:setString(key .. "#areaHa", num(f.areaInHa, 3))
        xml:setInt(key .. "#price", math.floor(f.price or 0))
        xml:setInt(key .. "#owner", fm:getFarmlandOwner(id) or 0)
        if f.xWorldPos ~= nil then
            xml:setString(key .. "#x", num(f.xWorldPos))
            xml:setString(key .. "#z", num(f.zWorldPos))
        end
        if f.showOnFarmlandsScreen == false then
            xml:setBool(key .. "#hidden", true)
        end
    end
    try("Grundstückskarte", function()
        local grid = self:farmlandGrid()
        if grid ~= nil then
            xml:setInt("farmingHubExport.farmlands.map#size", grid.size)
            for i, row in ipairs(grid.rows) do
                xml:setString(string.format("farmingHubExport.farmlands.map.row(%d)", i - 1), row)
            end
        end
    end)
    return #ids
end

-- ---------- Stationen und Produktionen ----------
local function hotspotTypeName(hotspot)
    local t = hotspot.placeableType
    if t ~= nil and PlaceableHotspot ~= nil and PlaceableHotspot.TYPE ~= nil then
        for name, value in pairs(PlaceableHotspot.TYPE) do
            if value == t then
                return name
            end
        end
    end
    return nil
end

-- Zyklen und Kosten pro Monat, egal ob das Spiel sie pro Monat, Stunde oder Minute führt
local function perMonth(p, base)
    if p[base .. "Month"] ~= nil then
        return p[base .. "Month"]
    elseif p[base .. "Hour"] ~= nil then
        return p[base .. "Hour"] * 24
    elseif p[base .. "Minute"] ~= nil then
        return p[base .. "Minute"] * 1440
    end
    return nil
end

local function writeRows(xml, key, list, tag)
    local n = 0
    for _, item in ipairs(list or {}) do
        local name = fillName(item.type or item.fillTypeIndex or item.fillType)
        if name ~= nil then
            local k = string.format("%s.%s(%d)", key, tag, n)
            xml:setString(k .. "#fillType", name)
            xml:setString(k .. "#amount", num(item.amount, 3))
            if item.sellDirectly then
                xml:setBool(k .. "#sellDirectly", true)
            end
            n = n + 1
        end
    end
end

-- Lager einer Produktion: je Ware Füllstand und Platz
local function writeStorage(xml, key, storage)
    if storage == nil then
        return
    end
    local types = storage.fillTypes or storage.supportedFillTypes or {}
    local levels = storage.fillLevels or {}
    local caps = storage.capacities or {}
    local n = 0
    local seen = {}
    local function put(index)
        if seen[index] then
            return
        end
        seen[index] = true
        local name = fillName(index)
        if name == nil or name == "UNKNOWN" then
            return
        end
        local level = call(storage, { "getFillLevel" }, index) or levels[index] or 0
        local cap = call(storage, { "getCapacity" }, index) or caps[index] or storage.capacityPerFillType or storage.capacity
        local k = string.format("%s.storage.fill(%d)", key, n)
        xml:setString(k .. "#fillType", name)
        xml:setString(k .. "#level", num(level, 1))
        if cap ~= nil then
            xml:setString(k .. "#capacity", num(cap, 0))
        end
        n = n + 1
    end
    for index, on in pairs(types) do
        if type(index) == "number" and on then
            put(index)
        elseif type(on) == "number" then
            put(on)
        end
    end
    for index in pairs(levels) do
        if type(index) == "number" then
            put(index)
        end
    end
end

function FarmingHubExport:writeProductions(xml, key, point)
    xml:setBool(key .. "#shared", point.sharedThroughputCapacity ~= false)
    local active = {}
    for _, p in ipairs(point.activeProductions or {}) do
        active[p] = true
    end
    for i, p in ipairs(point.productions or {}) do
        local k = string.format("%s.production(%d)", key, i - 1)
        xml:setString(k .. "#id", tostring(p.id))
        if p.name ~= nil then
            xml:setString(k .. "#name", text(p.name, point.owningPlaceable ~= nil and point.owningPlaceable.customEnvironment or nil))
        end
        local cycles, costs = perMonth(p, "cyclesPer"), perMonth(p, "costsPerActive")
        if cycles ~= nil then
            xml:setString(k .. "#cyclesPerMonth", num(cycles, 3))
        end
        if costs ~= nil then
            xml:setString(k .. "#costsPerMonth", num(costs, 2))
        end
        if active[p] then
            xml:setBool(k .. "#active", true)
        end
        if p.status ~= nil then
            xml:setInt(k .. "#status", p.status)
        end
        writeRows(xml, k .. ".inputs", p.inputs, "input")
        writeRows(xml, k .. ".outputs", p.outputs, "output")
    end
    try("Lager", writeStorage, xml, key, point.storage)
end

function FarmingHubExport:writePlaceables(xml)
    local list = (g_currentMission.placeableSystem ~= nil and g_currentMission.placeableSystem.placeables) or {}
    local n = 0
    for _, p in ipairs(list) do
        try("Gebäude", function()
            local prod = p.spec_productionPoint ~= nil and p.spec_productionPoint.productionPoint or nil
            local sell = p.spec_sellingStation ~= nil and p.spec_sellingStation.sellingStation or nil
            local buy = p.spec_buyingStation ~= nil and p.spec_buyingStation.buyingStation or nil
            local hotspots = p.spec_hotspots ~= nil and p.spec_hotspots.mapHotspots or {}
            local stall = p.spec_husbandryAnimals ~= nil
            if prod == nil and sell == nil and buy == nil and not stall and #hotspots == 0 then
                return
            end
            local key = string.format("farmingHubExport.placeables.placeable(%d)", n)
            n = n + 1
            local uid = (p.getUniqueId ~= nil and p:getUniqueId()) or p.uniqueId
            if uid ~= nil then
                xml:setString(key .. "#uniqueId", uid)
            end
            xml:setString(key .. "#filename", NetworkUtil.convertToNetworkFilename(p.configFileName or ""))
            xml:setString(key .. "#type", tostring(p.typeName or ""))
            if p.getName ~= nil then
                xml:setString(key .. "#name", tostring(p:getName() or ""))
            end
            xml:setInt(key .. "#farmId", (p.getOwnerFarmId ~= nil and p:getOwnerFarmId()) or 0)
            local x, z = nodePosition(p.rootNode)
            local hs = hotspots[1]
            if hs ~= nil and hs.getWorldPosition ~= nil then
                local hx, hz = hs:getWorldPosition()
                if hx ~= nil then
                    x, z = hx, hz
                end
            end
            if x ~= nil then
                xml:setString(key .. "#x", num(x))
                xml:setString(key .. "#z", num(z))
            end
            if hs ~= nil then
                local t = hotspotTypeName(hs)
                if t ~= nil then
                    xml:setString(key .. "#hotspot", t)
                end
            end
            local price = p.price
            if (price == nil or price == 0) and g_storeManager ~= nil and p.configFileName ~= nil then
                local item = g_storeManager:getItemByXMLFilename(p.configFileName)
                price = item ~= nil and item.price or nil
            end
            if price ~= nil and price > 0 then
                xml:setInt(key .. "#price", math.floor(price))
            end
            if sell ~= nil then
                xml:setString(key .. "#sells", fillList(sell.acceptedFillTypes))
            end
            if buy ~= nil then
                xml:setString(key .. "#buys", fillList(buy.providedFillTypes or buy.supportedFillTypes or buy.fillTypes))
            end
            if prod ~= nil then
                self:writeProductions(xml, key .. ".productionPoint", prod)
            end
            if stall then
                try("Stall", self.writeHusbandry, self, xml, key, p)
            end
        end)
    end
    return n
end

-- ---------- Waren ----------
-- Name in der Sprache des Spiels (auf einem deutschen Server deutsch), Grundpreis je 1000 l, Gewicht je 1000 l
function FarmingHubExport:writeFillTypes(xml)
    local list = call(g_fillTypeManager, { "getFillTypes" }) or g_fillTypeManager.fillTypes or {}
    xml:setString("farmingHubExport.fillTypes#language", tostring(g_languageShort or ""))
    local n = 0
    for _, ft in ipairs(list) do
        if ft.name ~= nil and ft.name ~= "UNKNOWN" then
            local k = string.format("farmingHubExport.fillTypes.fillType(%d)", n)
            xml:setString(k .. "#name", ft.name)
            if ft.title ~= nil then
                xml:setString(k .. "#title", tostring(ft.title))
            end
            if ft.pricePerLiter ~= nil then
                xml:setString(k .. "#price", num(ft.pricePerLiter * 1000, 0))
            end
            if ft.massPerLiter ~= nil then
                xml:setString(k .. "#mass", num(ft.massPerLiter * 1000, 3))
            end
            if ft.showOnPriceTable then
                xml:setBool(k .. "#priceTable", true)
            end
            n = n + 1
        end
    end
    return n
end

-- ---------- Früchte ----------
-- Wachstum laut growth.xml der Karte: je Frucht und Monat, ob gesät werden darf und wie die Stufen weiterspringen.
-- Daraus rechnet die Mod, in welchen Monaten sich die Frucht ernten lässt (wie der Kalender im Spiel).
local function parseRange(s)
    local a, b = string.match(tostring(s or ""), "^%s*(%d+)%s*%-%s*(%d+)%s*$")
    if a ~= nil then
        return tonumber(a), tonumber(b)
    end
    local n = tonumber(s)
    return n, n
end

-- Wo die Wachstumsdatei liegen kann. In DLC-Karten steckt sie im verschlüsselten Archiv, dort meldet fileExists
-- nichts, XMLFile.load klappt aber; darum wird jeder Kandidat direkt geladen (growthData).
function FarmingHubExport:growthFiles()
    local info = g_currentMission.missionInfo or {}
    local candidates, seen = {}, {}
    local function add(f)
        if f ~= nil and f ~= "" and not seen[f] then
            seen[f] = true
            table.insert(candidates, f)
        end
    end
    local mapXml = info.mapXMLFilename
    self.debugInfo = { map = tostring(mapXml), base = tostring(info.baseDirectory) }
    if mapXml ~= nil then
        local file = XMLFile.load("farmingHubMap", Utils.getFilename(mapXml, info.baseDirectory))
        if file ~= nil then
            for _, key in ipairs({ "map.growth#filename", "map.fruitTypes#filename" }) do
                local f = file:getString(key)
                if f ~= nil and f ~= "" then
                    add(Utils.getFilename(f, info.baseDirectory))
                end
            end
            file:delete()
        else
            self.debugInfo.mapLoad = "nicht ladbar"
        end
    end
    add("data/maps/maps_growth.xml")
    add("dataS/maps/maps_growth.xml")
    return candidates
end

function FarmingHubExport:growthData()
    if self.growth ~= nil then
        return self.growth
    end
    self.growth = {}
    self.growthTried = {}
    local file
    for _, name in ipairs(self:growthFiles()) do
        local f = XMLFile.load("farmingHubGrowth", name)
        local ok = f ~= nil and f:hasProperty("growth.seasonal.fruit(0)")
        table.insert(self.growthTried, name .. (f == nil and " (nicht ladbar)" or ok and " (ok)" or " (ohne growth.seasonal)"))
        if ok then
            file = f
            self.growthSource = name
            break
        elseif f ~= nil then
            f:delete()
        end
    end
    if file == nil then
        return self.growth
    end
    local i = 0
    while true do
        local k = string.format("growth.seasonal.fruit(%d)", i)
        if not file:hasProperty(k) then
            break
        end
        local fruit = { initial = file:getInt(k .. "#initialState", 1), periods = {} }
        local j = 0
        while true do
            local pk = string.format("%s.period(%d)", k, j)
            if not file:hasProperty(pk) then
                break
            end
            local p = { plant = file:getBool(pk .. "#plantingAllowed", false), updates = {} }
            local u = 0
            while true do
                local uk = string.format("%s.update(%d)", pk, u)
                if not file:hasProperty(uk) then
                    break
                end
                local lo, hi = parseRange(file:getString(uk .. "#range"))
                table.insert(p.updates, { lo = lo, hi = hi, add = file:getInt(uk .. "#add"), set = file:getInt(uk .. "#set") })
                u = u + 1
            end
            fruit.periods[file:getInt(pk .. "#index", j + 1)] = p
            j = j + 1
        end
        self.growth[string.upper(file:getString(k .. "#name") or "")] = fruit
        i = i + 1
    end
    file:delete()
    return self.growth
end

-- Säen erlaubt laut growth.xml; Ernte: ab jedem Saatmonat zwölf Monate weiterrechnen, erntereif = zwischen den
-- Erntestufen der Frucht
local function growthPeriods(ft, kind)
    local g = FarmingHubExport:growthData()[string.upper(ft.name or "")]
    if g == nil then
        return {}
    end
    local plant, harvest = {}, {}
    for p = 1, 12 do
        if g.periods[p] ~= nil and g.periods[p].plant then
            table.insert(plant, p)
        end
    end
    if kind == "plant" then
        return plant
    end
    local lo, hi = ft.minHarvestingGrowthState, ft.maxHarvestingGrowthState or ft.minHarvestingGrowthState
    if lo == nil then
        return {}
    end
    local seen = {}
    for _, start in ipairs(plant) do
        local state = math.max(1, g.initial or 1)
        for step = 1, 12 do
            local p = (start + step - 1) % 12 + 1
            for _, u in ipairs((g.periods[p] or {}).updates or {}) do
                if u.lo ~= nil and state >= u.lo and state <= u.hi then
                    if u.set ~= nil then
                        state = u.set
                    elseif u.add ~= nil then
                        state = state + u.add
                    end
                    break
                end
            end
            if state >= lo and state <= hi and not seen[p] then
                seen[p] = true
                table.insert(harvest, p)
            end
        end
    end
    return harvest
end

-- Monate, in denen sich eine Frucht säen bzw. ernten lässt (1 = März … 12 = Februar)
local function periods(ft, kind)
    local gs = g_currentMission.growthSystem
    local out = {}
    -- FS25: jede Frucht weiß selbst, ob sie in einem Monat gesät oder geerntet werden kann
    -- Mod 2.4 rief sie nur mit dem Monat auf und bekam für jede Frucht „2–12“: der erste Wert ist der Wachstumsmodus
    -- (1 = saisonal), der Monat kommt danach. Darum beide Aufrufe probieren und den nehmen, der sich je Monat unterscheidet.
    local own = kind == "plant" and "getIsPlantableInPeriod" or "getIsHarvestableInPeriod"
    if type(ft[own]) == "function" then
        -- immer der saisonale Modus, auch wenn auf dem Server Wachstum aus ist: gefragt ist der Kalender
        local mode = (GrowthMode ~= nil and GrowthMode.SEASONAL) or (GrowthSystem ~= nil and GrowthSystem.MODE ~= nil and GrowthSystem.MODE.SEASONAL) or 1
        local withMode, onlyPeriod = {}, {}
        for period = 1, 12 do
            local ok, v = pcall(ft[own], ft, mode, period)
            if ok and v == true then
                table.insert(withMode, period)
            end
            ok, v = pcall(ft[own], ft, period)
            if ok and v == true then
                table.insert(onlyPeriod, period)
            end
        end
        local function varies(t)
            return #t > 0 and #t < 12
        end
        -- „2–12“ ohne Modus heißt: Monat 1 wurde als saisonaler Modus gelesen, alle anderen als „ohne Jahreszeiten“
        local broken = #onlyPeriod == 11 and onlyPeriod[1] == 2
        if varies(withMode) or (#withMode == 12 and broken) then
            out = withMode
        elseif not broken then
            out = onlyPeriod
        end
        FarmingHubExport.periodCall = FarmingHubExport.periodCall or (varies(withMode) and "modus,monat" or not broken and "monat" or nil)
    end
    local ok, fromXml = true, {}
    if #out == 0 then
        ok, fromXml = pcall(growthPeriods, ft, kind)
    end
    if ok then
        for _, p in ipairs(fromXml) do
            table.insert(out, p)
        end
    end
    local names = kind == "plant" and { "canFruitBePlanted", "getCanFruitBePlanted", "getIsPlantableInPeriod", "canPlantInPeriod" }
        or { "canFruitBeHarvested", "getCanFruitBeHarvested", "getIsHarvestableInPeriod", "canHarvestInPeriod" }
    if gs ~= nil and #out == 0 then
        for period = 1, 12 do
            if call(gs, names, ft.index, period) == true then
                table.insert(out, period)
            end
        end
    end
    if #out == 0 then
        local t = kind == "plant" and (ft.plantPeriods or ft.plantingPeriods) or (ft.harvestPeriods or ft.harvestingPeriods)
        if type(t) == "table" then
            for k, v in pairs(t) do
                local period = (v == true and k) or v
                if type(period) == "number" and period >= 1 and period <= 12 then
                    table.insert(out, period)
                end
            end
        end
    end
    table.sort(out)
    local s = {}
    for _, p in ipairs(out) do
        table.insert(s, tostring(p))
    end
    return table.concat(s, " ")
end

local function color(c)
    if type(c) ~= "table" then
        return nil
    end
    local r, g, b = c[1] or c.r, c[2] or c.g, c[3] or c.b
    if r == nil or g == nil or b == nil then
        return nil
    end
    -- Linear wie im Spiel → sRGB für die Website
    local function s(v)
        v = math.max(0, math.min(1, v))
        v = v <= 0.0031308 and v * 12.92 or 1.055 * v ^ (1 / 2.4) - 0.055
        return math.floor(v * 255 + 0.5)
    end
    return string.format("#%02x%02x%02x", s(r), s(g), s(b))
end

-- Diagnose für den Hub-Entwickler: welche Wachstumsdateien probiert wurden und welche Funktionen das Wachstumssystem
-- und eine Frucht im Spiel haben (nur Namen), damit sich Saat- und Erntemonate auch ohne Datei finden lassen
local function names(obj, pattern)
    local out, seen = {}, {}
    local depth = 0
    while type(obj) == "table" and depth < 4 do
        for k, v in pairs(obj) do
            if type(k) == "string" and not seen[k] and (pattern == nil or string.find(string.lower(k), pattern)) then
                seen[k] = true
                table.insert(out, k .. (type(v) == "function" and "()" or ""))
            end
        end
        local mt = getmetatable(obj)
        obj = mt ~= nil and (type(mt.__index) == "table" and mt.__index or mt) or nil
        depth = depth + 1
    end
    table.sort(out)
    return table.concat(out, " ")
end

function FarmingHubExport:writeDebug(xml, list)
    local k = "farmingHubExport.debug"
    local info = self.debugInfo or {}
    xml:setString(k .. "#map", info.map or "")
    xml:setString(k .. "#base", info.base or "")
    if info.mapLoad ~= nil then
        xml:setString(k .. "#mapLoad", info.mapLoad)
    end
    for i, t in ipairs(self.growthTried or {}) do
        xml:setString(string.format("%s.tried(%d)#file", k, i - 1), t)
    end
    xml:setString(k .. ".growthSystem#names", names(g_currentMission.growthSystem))
    for _, ft in ipairs(list) do
        if ft.name == "WHEAT" then
            xml:setString(k .. ".fruitType#names", names(ft))
            if type(ft.growthDataSeasonal) == "table" then
                xml:setString(k .. ".fruitType#seasonal", names(ft.growthDataSeasonal))
            end
        end
    end
    xml:setString(k .. ".fruitTypeManager#names", names(g_fruitTypeManager, "grow"))
end

function FarmingHubExport:writeFruitTypes(xml)
    local list = call(g_fruitTypeManager, { "getFruitTypes" }) or g_fruitTypeManager.fruitTypes or {}
    local n = 0
    try("Wachstum", function() self:growthData() end)
    if self.growthSource ~= nil then
        xml:setString("farmingHubExport.fruitTypes#growth", self.growthSource)
    end
    try("Diagnose", function() self:writeDebug(xml, list) end)
    for _, ft in ipairs(list) do
        if ft.name ~= nil then
            local k = string.format("farmingHubExport.fruitTypes.fruitType(%d)", n)
            xml:setString(k .. "#name", ft.name)
            xml:setInt(k .. "#index", ft.index or 0)
            local dens = ft.densityTypeIndex or ft.foliageTypeIndex or ft.typeIndex
            if dens ~= nil then
                xml:setInt(k .. "#density", dens)
            end
            if ft.fillType ~= nil and ft.fillType.name ~= nil then
                xml:setString(k .. "#fillType", ft.fillType.name)
            end
            local function int(attr, v)
                if type(v) == "number" then
                    xml:setInt(k .. "#" .. attr, v)
                end
            end
            int("growthStates", ft.numGrowthStates)
            int("harvestMin", ft.minHarvestingGrowthState)
            int("harvestMax", ft.maxHarvestingGrowthState)
            int("cut", ft.cutState)
            int("withered", ft.witheredState)
            int("prepareMin", ft.minPreparingGrowthState)
            int("prepareMax", ft.maxPreparingGrowthState)
            int("regrowState", ft.firstRegrowthState)
            if ft.regrows then
                xml:setBool(k .. "#regrows", true)
            end
            if ft.literPerSqm ~= nil then
                xml:setString(k .. "#literPerSqm", num(ft.literPerSqm, 4))
            end
            if ft.seedUsagePerSqm ~= nil then
                xml:setString(k .. "#seedPerSqm", num(ft.seedUsagePerSqm, 5))
            end
            if ft.windrowLiterPerSqm ~= nil then
                xml:setString(k .. "#windrowPerSqm", num(ft.windrowLiterPerSqm, 4))
            end
            if ft.windrowName ~= nil then
                xml:setString(k .. "#windrow", tostring(ft.windrowName))
            elseif ft.windrowFillType ~= nil and ft.windrowFillType.name ~= nil then
                xml:setString(k .. "#windrow", ft.windrowFillType.name)
            end
            local c = color(ft.defaultMapColor or ft.mapColor)
            if c ~= nil then
                xml:setString(k .. "#color", c)
            end
            if ft.allowsSeeding == false then
                xml:setBool(k .. "#noSeeding", true)
            end
            try("Anbauzeiten " .. ft.name, function()
                local plant, harvest = periods(ft, "plant"), periods(ft, "harvest")
                if plant ~= "" then
                    xml:setString(k .. "#plant", plant)
                end
                if harvest ~= "" then
                    xml:setString(k .. "#harvest", harvest)
                end
            end)
            n = n + 1
        end
    end
    if FarmingHubExport.periodCall ~= nil then
        xml:setString("farmingHubExport.fruitTypes#periodCall", FarmingHubExport.periodCall)
    end
    return n
end

-- ---------- Katalog: alle Produktionen aus dem Shop ----------
-- Liest die Gebäude-XML jedes Shop-Eintrags mit Produktion (auch aus DLCs, die das Spiel geladen hat). Ändert sich nicht,
-- solange das Spiel läuft: einmal lesen und merken.
local function readRecipes(file, env)
    local out = { productions = {}, storage = {}, shared = true }
    out.shared = file:getBool("placeable.productionPoint.productions#sharedThroughputCapacity", true)
    local i = 0
    while true do
        local k = string.format("placeable.productionPoint.productions.production(%d)", i)
        if not file:hasProperty(k) then
            break
        end
        local r = { id = file:getString(k .. "#id") or tostring(i), name = text(file:getString(k .. "#name"), env), inputs = {}, outputs = {} }
        local function per(base)
            local m = file:getFloat(k .. "#" .. base .. "Month")
            if m ~= nil then
                return m
            end
            local h = file:getFloat(k .. "#" .. base .. "Hour")
            if h ~= nil then
                return h * 24
            end
            local mi = file:getFloat(k .. "#" .. base .. "Minute")
            return mi ~= nil and mi * 1440 or nil
        end
        r.cycles = per("cyclesPer")
        r.costs = per("costsPerActive")
        for _, side in ipairs({ "input", "output" }) do
            local j = 0
            while true do
                local kk = string.format("%s.%ss.%s(%d)", k, side, side, j)
                if not file:hasProperty(kk) then
                    break
                end
                table.insert(side == "input" and r.inputs or r.outputs, { fill = file:getString(kk .. "#fillType"), amount = file:getFloat(kk .. "#amount", 1), sell = file:getBool(kk .. "#sellDirectly", false) })
                j = j + 1
            end
        end
        table.insert(out.productions, r)
        i = i + 1
    end
    out.capacity = file:getInt("placeable.productionPoint.storage#capacityPerFillType")
    local j = 0
    while true do
        local kk = string.format("placeable.productionPoint.storage.capacity(%d)", j)
        if not file:hasProperty(kk) then
            break
        end
        table.insert(out.storage, { fill = file:getString(kk .. "#fillType"), capacity = file:getInt(kk .. "#capacity") })
        j = j + 1
    end
    return out
end

function FarmingHubExport:catalog()
    if self.catalogCache ~= nil then
        return self.catalogCache
    end
    local items = call(g_storeManager, { "getItems" }) or g_storeManager.items or {}
    local out = {}
    for _, item in ipairs(items) do
        local isPlaceable = item.species == "placeable" or (StoreSpecies ~= nil and item.species == StoreSpecies.PLACEABLE)
        if isPlaceable and item.xmlFilename ~= nil then
            try("Katalog " .. tostring(item.xmlFilename), function()
                local file = XMLFile.load("farmingHubCatalog", item.xmlFilename)
                if file == nil then
                    return
                end
                if file:hasProperty("placeable.productionPoint.productions.production(0)") then
                    local r = readRecipes(file, item.customEnvironment)
                    r.file = NetworkUtil.convertToNetworkFilename(item.xmlFilename)
                    r.name = tostring(item.name or "")
                    r.price = item.price
                    r.category = item.categoryName
                    r.dlc = item.dlcTitle or item.customEnvironment
                    table.insert(out, r)
                end
                file:delete()
            end)
        end
    end
    self.catalogCache = out
    return out
end

function FarmingHubExport:writeCatalog(xml)
    local list = self:catalog()
    for n, b in ipairs(list) do
        local key = string.format("farmingHubExport.catalog.building(%d)", n - 1)
        xml:setString(key .. "#filename", b.file)
        xml:setString(key .. "#name", b.name)
        if b.price ~= nil then
            xml:setInt(key .. "#price", math.floor(b.price))
        end
        if b.category ~= nil then
            xml:setString(key .. "#category", tostring(b.category))
        end
        if b.dlc ~= nil then
            xml:setString(key .. "#dlc", tostring(b.dlc))
        end
        xml:setBool(key .. "#shared", b.shared ~= false)
        if b.capacity ~= nil then
            xml:setInt(key .. "#capacity", b.capacity)
        end
        for i, r in ipairs(b.productions) do
            local k = string.format("%s.production(%d)", key, i - 1)
            xml:setString(k .. "#id", r.id)
            if r.name ~= nil then
                xml:setString(k .. "#name", r.name)
            end
            if r.cycles ~= nil then
                xml:setString(k .. "#cyclesPerMonth", num(r.cycles, 3))
            end
            if r.costs ~= nil then
                xml:setString(k .. "#costsPerMonth", num(r.costs, 2))
            end
            for side, rows in pairs({ input = r.inputs, output = r.outputs }) do
                for j, row in ipairs(rows) do
                    local kk = string.format("%s.%ss.%s(%d)", k, side, side, j - 1)
                    xml:setString(kk .. "#fillType", tostring(row.fill or ""))
                    xml:setString(kk .. "#amount", num(row.amount, 3))
                    if row.sell then
                        xml:setBool(kk .. "#sellDirectly", true)
                    end
                end
            end
        end
        for i, s in ipairs(b.storage) do
            local kk = string.format("%s.storage.capacity(%d)", key, i - 1)
            xml:setString(kk .. "#fillType", tostring(s.fill or ""))
            if s.capacity ~= nil then
                xml:setInt(kk .. "#capacity", s.capacity)
            end
        end
    end
    return #list
end

-- ---------- Tiere ----------
-- Für das Wiki der Website: alle Tierarten mit Unterarten (Rassen, Geschlecht), was sie je nach Alter fressen, trinken,
-- an Stroh brauchen und liefern, was sie kosten, wann sie Nachwuchs bekommen, dazu die Futtergruppen mit ihrem Anteil an
-- der Leistung, Futtermischungen und die Ställe aus dem Shop. Die Werte des Spiels sind Kurven über das Alter in Monaten;
-- „pro Tag“ im Spiel heißt: je Spielstunde ein 24stel, mal timeAdjustment.

-- Erstes Feld einer Tabelle, das es gibt (Spielversionen benennen manches anders)
local function pick(t, keys)
    if type(t) ~= "table" then
        return nil
    end
    for _, k in ipairs(keys) do
        if t[k] ~= nil then
            return t[k]
        end
    end
    return nil
end

local function short(v)
    return (string.gsub(string.format("%.3f", v), "%.?0+$", ""))
end

-- Kurve des Spiels (Alter in Monaten → Wert) als „alter:wert alter:wert …“: die Stützpunkte, sonst Monat für Monat abgetastet
local function curve(c)
    if type(c) ~= "table" then
        return nil
    end
    local out = {}
    for _, kf in ipairs(c.keyframes or {}) do
        local t, v = kf.time, kf[1] or kf.value
        if type(t) == "number" and type(v) == "number" then
            table.insert(out, short(t) .. ":" .. short(v))
        end
    end
    if #out == 0 and type(c.get) == "function" then
        local last
        for age = 0, 120 do
            local ok, v = pcall(c.get, c, age)
            if ok and type(v) == "number" and short(v) ~= last then
                last = short(v)
                table.insert(out, age .. ":" .. last)
            end
        end
    end
    return #out > 0 and table.concat(out, " ") or nil
end

local function indexList(list)
    local out = {}
    for _, index in pairs(list or {}) do
        local name = type(index) == "number" and fillName(index) or nil
        if name ~= nil then
            table.insert(out, name)
        end
    end
    return table.concat(out, " ")
end

-- Name einer Konstante, z. B. AnimalFoodSystem.FOOD_CONSUME_TYPE_PARALLEL → „PARALLEL“
local function constName(class, prefix, value)
    if type(class) ~= "table" or value == nil then
        return nil
    end
    for name, v in pairs(class) do
        if v == value and type(name) == "string" and string.sub(name, 1, #prefix) == prefix then
            return string.sub(name, #prefix + 1)
        end
    end
    return nil
end

function FarmingHubExport:writeAnimalFood(xml, k, typeIndex)
    local food = g_currentMission.animalFoodSystem
    if food == nil then
        return
    end
    local af = call(food, { "getAnimalFood" }, typeIndex)
    if af ~= nil then
        local ct = af.consumptionType
        xml:setString(k .. ".food#consumption", constName(AnimalFoodSystem, "FOOD_CONSUME_TYPE_", ct) or tostring(ct or ""))
        for i, g in ipairs(af.groups or {}) do
            local kk = string.format("%s.food.group(%d)", k, i - 1)
            xml:setString(kk .. "#title", text(g.title) or "")
            xml:setString(kk .. "#productionWeight", num(g.productionWeight, 3))
            xml:setString(kk .. "#eatWeight", num(g.eatWeight, 3))
            xml:setString(kk .. "#fillTypes", indexList(g.fillTypes))
        end
    end
    for i, ft in ipairs(call(food, { "getMixturesByAnimalTypeIndex" }, typeIndex) or {}) do
        local kk = string.format("%s.food.mixture(%d)", k, i - 1)
        xml:setString(kk .. "#fillType", fillName(ft) or "")
        local mix = call(food, { "getMixtureByFillType" }, ft)
        for j, ing in ipairs((mix or {}).ingredients or {}) do
            local ki = string.format("%s.ingredient(%d)", kk, j - 1)
            xml:setString(ki .. "#weight", num(ing.weight, 3))
            xml:setString(ki .. "#fillTypes", indexList(ing.fillTypes))
        end
    end
end

function FarmingHubExport:writeSubType(xml, k, st)
    xml:setString(k .. "#name", tostring(st.name or ""))
    local fill = fillName(st.fillTypeIndex)
    if fill ~= nil then
        xml:setString(k .. "#fillType", fill)
        local title = g_fillTypeManager.getFillTypeTitleByIndex ~= nil and g_fillTypeManager:getFillTypeTitleByIndex(st.fillTypeIndex) or nil
        if title ~= nil then
            xml:setString(k .. "#title", tostring(title))
        end
    end
    if st.gender ~= nil then
        xml:setString(k .. "#gender", tostring(st.gender))
    end
    if st.breed ~= nil then
        xml:setString(k .. "#breed", tostring(text(st.breed) or st.breed))
    end
    local minAge = pick(st, { "reproductionMinAgeMonth", "reproductionMinAge" })
    local duration = pick(st, { "reproductionDurationMonth", "reproductionDuration" })
    local health = pick(st, { "reproductionMinHealth", "reproductionMinHealthFactor" })
    if type(minAge) == "number" then
        xml:setString(k .. ".reproduction#minAgeMonth", short(minAge))
    end
    if type(duration) == "number" then
        xml:setString(k .. ".reproduction#durationMonth", short(duration))
    end
    if type(health) == "number" then
        xml:setString(k .. ".reproduction#minHealth", short(health))
    end
    if st.supportsReproduction == false then
        xml:setBool(k .. ".reproduction#none", true)
    end
    local prices = type(st.prices) == "table" and st.prices or {}
    local c = 0
    local function put(kind, value, fillType)
        local s = curve(value)
        if s == nil then
            return
        end
        local kk = string.format("%s.curve(%d)", k, c)
        c = c + 1
        xml:setString(kk .. "#kind", kind)
        if fillType ~= nil then
            xml:setString(kk .. "#fillType", fillName(fillType) or "")
        end
        xml:setString(kk .. "#pts", s)
    end
    put("buy", st.buyPrice or prices.buy)
    put("sell", st.sellPrice or prices.sell)
    put("transport", st.transportPrice or prices.transport)
    local input, output = st.input or {}, st.output or {}
    put("food", input.food)
    put("straw", input.straw)
    put("water", input.water)
    put("manure", output.manure)
    put("liquidManure", output.liquidManure)
    for _, kind in ipairs({ "milk", "pallets" }) do
        local o = output[kind]
        if type(o) == "table" then
            put(kind, o.curve or o, o.fillType)
        end
    end
    -- Alles Weitere, was die Rasse liefert oder braucht (z. B. Alpakavlies aus einem DLC): unter seinem eigenen Namen, und
    -- die Schlüssel zur Diagnose, falls ein Erzeugnis woanders steht
    local known = { food = true, straw = true, water = true, manure = true, liquidManure = true, milk = true, pallets = true }
    local keys = {}
    for _, side in ipairs({ { "in", input }, { "out", output } }) do
        for key, o in pairs(side[2]) do
            table.insert(keys, side[1] .. ":" .. tostring(key))
            if not known[key] and type(key) == "string" then
                if type(o) == "table" and (o.curve ~= nil or o.fillType ~= nil) then
                    put(key, o.curve or o, o.fillType)
                else
                    put(key, o)
                end
            end
        end
    end
    table.sort(keys)
    xml:setString(k .. "#keys", table.concat(keys, " "))
    local fields = {}
    for key in pairs(st) do
        table.insert(fields, tostring(key))
    end
    table.sort(fields)
    xml:setString(k .. "#fields", table.concat(fields, " "))
end

-- Ställe aus dem Shop (Preis, Platz für wie viele Tiere): einmal lesen und merken
function FarmingHubExport:stalls()
    if self.stallCache ~= nil then
        return self.stallCache
    end
    local out = {}
    for _, item in ipairs(call(g_storeManager, { "getItems" }) or g_storeManager.items or {}) do
        local isPlaceable = item.species == "placeable" or (StoreSpecies ~= nil and item.species == StoreSpecies.PLACEABLE)
        if isPlaceable and item.xmlFilename ~= nil then
            try("Stall " .. tostring(item.xmlFilename), function()
                local file = XMLFile.load("farmingHubStall", item.xmlFilename)
                if file == nil then
                    return
                end
                local animalType = file:getString("placeable.husbandry.animals#type")
                if animalType ~= nil then
                    table.insert(out, { name = tostring(item.name or ""), price = item.price, type = animalType, dlc = item.dlcTitle or item.customEnvironment,
                        max = file:getInt("placeable.husbandry.animals#maxNumAnimals"), food = file:getInt("placeable.husbandry.food#capacity"),
                        file = NetworkUtil.convertToNetworkFilename(item.xmlFilename) })
                end
                file:delete()
            end)
        end
    end
    self.stallCache = out
    return out
end

function FarmingHubExport:writeAnimals(xml)
    local sys = g_currentMission.animalSystem
    if sys == nil then
        return 0
    end
    local root = "farmingHubExport.animals"
    local env = g_currentMission.environment
    if env ~= nil and type(env.timeAdjustment) == "number" then
        xml:setString(root .. "#timeAdjustment", string.format("%.6f", env.timeAdjustment))
    end
    local n = 0
    for _, t in ipairs(call(sys, { "getTypes" }) or sys.types or {}) do
        if t.name ~= nil then
            local k = string.format("%s.animal(%d)", root, n)
            n = n + 1
            xml:setString(k .. "#type", t.name)
            local title = text(pick(t, { "groupTitle", "title" }))
            if title ~= nil then
                xml:setString(k .. "#title", title)
            end
            try("Futter " .. t.name, function() self:writeAnimalFood(xml, k, t.typeIndex) end)
            for j, si in ipairs(t.subTypes or {}) do
                local st = type(si) == "table" and si or sys:getSubTypeByIndex(si)
                if st ~= nil then
                    try("Tier " .. tostring(st.name), function() self:writeSubType(xml, string.format("%s.subType(%d)", k, j - 1), st) end)
                end
            end
        end
    end
    -- Futtermischungen, die man im Futtermischwagen anmischt (Totalmischration): Zutaten mit Mindest- und Höchstanteil
    local food = g_currentMission.animalFoodSystem
    for i, r in ipairs((food or {}).recipes or {}) do
        local k = string.format("%s.recipe(%d)", root, i - 1)
        xml:setString(k .. "#fillType", fillName(r.fillType) or "")
        for j, ing in ipairs(r.ingredients or {}) do
            local kk = string.format("%s.ingredient(%d)", k, j - 1)
            xml:setString(kk .. "#title", text(ing.title) or tostring(ing.name or ""))
            xml:setString(kk .. "#min", num(ing.minPercentage, 3))
            xml:setString(kk .. "#max", num(ing.maxPercentage, 3))
            xml:setString(kk .. "#fillTypes", indexList(ing.fillTypes))
        end
    end
    try("Ställe", function()
        for i, s in ipairs(self:stalls()) do
            local k = string.format("%s.stall(%d)", root, i - 1)
            xml:setString(k .. "#name", s.name)
            xml:setString(k .. "#type", s.type)
            xml:setString(k .. "#filename", s.file)
            if s.price ~= nil then
                xml:setInt(k .. "#price", math.floor(s.price))
            end
            if s.max ~= nil then
                xml:setInt(k .. "#maxAnimals", s.max)
            end
            if s.food ~= nil then
                xml:setInt(k .. "#foodCapacity", s.food)
            end
            if s.dlc ~= nil then
                xml:setString(k .. "#dlc", tostring(s.dlc))
            end
        end
    end)
    -- Diagnose: Feldnamen einer Unterart, einer Art, des Futtersystems und der Umwelt (falls oben etwas fehlt)
    local types = call(sys, { "getTypes" }) or sys.types or {}
    local first = types[1]
    if first ~= nil then
        local si = (first.subTypes or {})[1]
        local st = type(si) == "table" and si or (si ~= nil and sys:getSubTypeByIndex(si)) or nil
        xml:setString(root .. ".debug#type", names(first))
        if st ~= nil then
            xml:setString(root .. ".debug#subType", names(st))
        end
    end
    xml:setString(root .. ".debug#foodSystem", names(food))
    xml:setString(root .. ".debug#environment", names(env))
    return n
end

-- Ein Stall im Spiel: Tiere, Zustand (Stroh, Wasser, Mist, Gülle, Milch …) und Futter je Gruppe wie im Menü „Tiere“
function FarmingHubExport:writeHusbandry(xml, key, p)
    local k = key .. ".husbandry"
    local typeIndex = call(p, { "getAnimalTypeIndex" })
    local sys = g_currentMission.animalSystem
    local t = sys ~= nil and typeIndex ~= nil and call(sys, { "getTypeByIndex" }, typeIndex) or nil
    if t ~= nil and t.name ~= nil then
        xml:setString(k .. "#type", t.name)
    end
    local numAnimals, maxAnimals = call(p, { "getNumOfAnimals" }), call(p, { "getMaxNumOfAnimals" })
    if type(numAnimals) == "number" then
        xml:setInt(k .. "#animals", numAnimals)
    end
    if type(maxAnimals) == "number" then
        xml:setInt(k .. "#maxAnimals", maxAnimals)
    end
    local prod = call(p, { "getGlobalProductionFactor" })
    if type(prod) == "number" then
        xml:setString(k .. "#productivity", num(prod, 3))
    end
    local n = 0
    for _, kind in ipairs({ "condition", "food" }) do
        local infos = call(p, { kind == "condition" and "getConditionInfos" or "getFoodInfos" }) or {}
        for _, info in ipairs(infos) do
            local kk = string.format("%s.info(%d)", k, n)
            n = n + 1
            xml:setString(kk .. "#kind", kind)
            xml:setString(kk .. "#title", tostring(info.title or ""))
            if type(info.value) == "number" then
                xml:setString(kk .. "#value", num(info.value, 1))
            end
            if type(info.capacity) == "number" then
                xml:setString(kk .. "#capacity", num(info.capacity, 0))
            end
            if type(info.ratio) == "number" then
                xml:setString(kk .. "#ratio", num(info.ratio, 3))
            end
            if info.invertedBar then
                xml:setBool(kk .. "#inverted", true)
            end
        end
    end
    for i, c in ipairs(call(p, { "getClusters" }) or {}) do
        local st = sys ~= nil and sys:getSubTypeByIndex(c.subTypeIndex) or nil
        local kk = string.format("%s.cluster(%d)", k, i - 1)
        xml:setString(kk .. "#subType", st ~= nil and tostring(st.name) or "")
        xml:setInt(kk .. "#num", call(c, { "getNumAnimals" }) or c.numAnimals or 0)
        xml:setInt(kk .. "#age", call(c, { "getAge" }) or c.age or 0)
        if type(c.health) == "number" then
            xml:setString(kk .. "#health", num(c.health, 0))
        end
        if type(c.reproduction) == "number" then
            xml:setString(kk .. "#reproduction", num(c.reproduction, 0))
        end
    end
end

-- ---------- Datei ----------
function FarmingHubExport:write(filename)
    local mission = g_currentMission
    local xml = XMLFile.create("farmingHubExport", filename, "farmingHubExport")
    if xml == nil then
        Logging.error("FarmingHubExport: %s lässt sich nicht anlegen", filename)
        return false
    end
    local info = mission.missionInfo or {}
    xml:setInt("farmingHubExport#version", FarmingHubExport.VERSION)
    xml:setString("farmingHubExport#mapId", tostring(info.mapId or ""))
    xml:setString("farmingHubExport#mapTitle", tostring(info.mapTitle or ""))
    xml:setInt("farmingHubExport#mapSize", math.floor(mission.terrainSize or 2048))
    xml:setString("farmingHubExport#saveDate", getDate("%Y-%m-%d %H:%M"))
    if mission.environment ~= nil then
        xml:setInt("farmingHubExport#day", mission.environment.currentMonotonicDay or mission.environment.currentDay or 0)
        if mission.environment.daysPerPeriod ~= nil then
            xml:setInt("farmingHubExport#daysPerPeriod", mission.environment.daysPerPeriod)
        end
        -- Südhalbkugel: Monat 1 ist dort September statt März (der Anbaukalender im Spiel beginnt dann mit September)
        local env = mission.environment
        local south = call(env, { "getIsSouthernHemisphere" })
        if south == nil then
            south = pick(env, { "isSouthernHemisphere", "southernHemisphere" })
        end
        local lat = pick(env, { "latitude" }) or pick(env.daylight, { "latitude" })
        if south == nil and type(lat) == "number" then
            south = lat < 0
        end
        if type(south) == "boolean" then
            xml:setString("farmingHubExport#hemisphere", south and "south" or "north")
        end
    end
    local counts = {}
    try("Felder", function() counts.fields = self:writeFields(xml) end)
    try("Grundstücke", function() counts.farmlands = self:writeFarmlands(xml) end)
    try("Stationen", function() counts.placeables = self:writePlaceables(xml) end)
    try("Waren", function() counts.fillTypes = self:writeFillTypes(xml) end)
    try("Früchte", function() counts.fruitTypes = self:writeFruitTypes(xml) end)
    try("Katalog", function() counts.catalog = self:writeCatalog(xml) end)
    try("Tiere", function() counts.animals = self:writeAnimals(xml) end)
    xml:save()
    xml:delete()
    return true, counts
end

function FarmingHubExport.targetFile()
    local info = g_currentMission ~= nil and g_currentMission.missionInfo or nil
    local dir = info ~= nil and info.savegameDirectory or nil
    if dir ~= nil and dir ~= "" then
        return dir .. "/" .. FarmingHubExport.FILENAME
    end
    return nil
end

-- Nach dem Speichern des Spielstands: Datei daneben schreiben (nur Server bzw. Einzelspieler)
function FarmingHubExport.onSave()
    if g_currentMission == nil or not g_currentMission:getIsServer() then
        return
    end
    local file = FarmingHubExport.targetFile()
    if file ~= nil then
        try("Speichern", function() FarmingHubExport:write(file) end)
    end
end

function FarmingHubExport:consoleCommandExport()
    if g_currentMission == nil or not g_currentMission:getIsServer() then
        return "hubExport: nur auf dem Server oder im Einzelspieler"
    end
    local file = FarmingHubExport.targetFile()
    if file == nil then
        -- Noch nie gespeichert: in den modSettings-Ordner
        local dir = getUserProfileAppPath() .. "modSettings"
        createFolder(dir)
        file = dir .. "/" .. FarmingHubExport.FILENAME
    end
    local ok, counts = FarmingHubExport:write(file)
    if not ok then
        return "hubExport: Schreiben fehlgeschlagen"
    end
    return string.format("hubExport: %s geschrieben (%d Felder, %d Grundstücke, %d Gebäude, %d Waren, %d Früchte, %d Produktionen im Shop, %d Tierarten)", file,
        counts.fields or 0, counts.farmlands or 0, counts.placeables or 0, counts.fillTypes or 0, counts.fruitTypes or 0, counts.catalog or 0, counts.animals or 0)
end

function FarmingHubExport:loadMap(filename)
    addConsoleCommand("hubExport", "Schreibt farmingHubExport.xml für den Farming Hub", "consoleCommandExport", FarmingHubExport)
end

function FarmingHubExport:deleteMap()
    removeConsoleCommand("hubExport")
    self.grid = nil
    self.catalogCache = nil
    self.stallCache = nil
    self.growth = nil
    self.growthSource = nil
    self.growthTried = nil
    FarmingHubExport.periodCall = nil
end

if FSBaseMission.saveSavegame ~= nil then
    FSBaseMission.saveSavegame = Utils.appendedFunction(FSBaseMission.saveSavegame, FarmingHubExport.onSave)
else
    FSCareerMissionInfo.saveToXMLFile = Utils.appendedFunction(FSCareerMissionInfo.saveToXMLFile, FarmingHubExport.onSave)
end
addModEventListener(FarmingHubExport)
