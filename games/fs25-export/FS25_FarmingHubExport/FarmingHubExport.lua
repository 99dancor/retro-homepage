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
            if prod == nil and sell == nil and buy == nil and #hotspots == 0 then
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

function FarmingHubExport:growthFile()
    local info = g_currentMission.missionInfo or {}
    local candidates = {}
    local mapXml = info.mapXMLFilename
    if mapXml ~= nil then
        local file = XMLFile.load("farmingHubMap", Utils.getFilename(mapXml, info.baseDirectory))
        if file ~= nil then
            local g = file:getString("map.growth#filename")
            if g ~= nil then
                table.insert(candidates, Utils.getFilename(g, info.baseDirectory))
            end
            file:delete()
        end
    end
    table.insert(candidates, "data/maps/maps_growth.xml")
    table.insert(candidates, "dataS/maps/maps_growth.xml")
    for _, f in ipairs(candidates) do
        if f ~= nil and fileExists(f) then
            return f
        end
    end
    return nil
end

function FarmingHubExport:growthData()
    if self.growth ~= nil then
        return self.growth
    end
    self.growth = {}
    local name = self:growthFile()
    self.growthSource = name
    local file = name ~= nil and XMLFile.load("farmingHubGrowth", name) or nil
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
    local ok, fromXml = pcall(growthPeriods, ft, kind)
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

function FarmingHubExport:writeFruitTypes(xml)
    local list = call(g_fruitTypeManager, { "getFruitTypes" }) or g_fruitTypeManager.fruitTypes or {}
    local n = 0
    try("Wachstum", function() self:growthData() end)
    if self.growthSource ~= nil then
        xml:setString("farmingHubExport.fruitTypes#growth", self.growthSource)
    end
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
    end
    local counts = {}
    try("Felder", function() counts.fields = self:writeFields(xml) end)
    try("Grundstücke", function() counts.farmlands = self:writeFarmlands(xml) end)
    try("Stationen", function() counts.placeables = self:writePlaceables(xml) end)
    try("Waren", function() counts.fillTypes = self:writeFillTypes(xml) end)
    try("Früchte", function() counts.fruitTypes = self:writeFruitTypes(xml) end)
    try("Katalog", function() counts.catalog = self:writeCatalog(xml) end)
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
    return string.format("hubExport: %s geschrieben (%d Felder, %d Grundstücke, %d Gebäude, %d Waren, %d Früchte, %d Produktionen im Shop)", file,
        counts.fields or 0, counts.farmlands or 0, counts.placeables or 0, counts.fillTypes or 0, counts.fruitTypes or 0, counts.catalog or 0)
end

function FarmingHubExport:loadMap(filename)
    addConsoleCommand("hubExport", "Schreibt farmingHubExport.xml für den Farming Hub", "consoleCommandExport", FarmingHubExport)
end

function FarmingHubExport:deleteMap()
    removeConsoleCommand("hubExport")
    self.grid = nil
    self.catalogCache = nil
    self.growth = nil
    self.growthSource = nil
end

if FSBaseMission.saveSavegame ~= nil then
    FSBaseMission.saveSavegame = Utils.appendedFunction(FSBaseMission.saveSavegame, FarmingHubExport.onSave)
else
    FSCareerMissionInfo.saveToXMLFile = Utils.appendedFunction(FSCareerMissionInfo.saveToXMLFile, FarmingHubExport.onSave)
end
addModEventListener(FarmingHubExport)
