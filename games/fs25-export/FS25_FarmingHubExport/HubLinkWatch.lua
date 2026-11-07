-- FS25 Hub Link: Plantagen, Ballen und Tracker (ab Mod 3.7)
--
-- Plantagen   Kaffee, Bananen, Wein und Oliven sind im Spiel keine Felder, sondern Gebäude mit Pflanzreihen (PlaceableVine
--             bzw. eine Spezialisierung des DLC mit denselben Feldern fruitType und nodes). Jede Reihe kennt ihre Fläche je
--             Wachstumsstufe (growthValues). Daraus: Anteil erntereif, Anteil verwelkt (zurückschneiden) und, wenn das Spiel
--             ihn irgendwo verrät, Anteil krank (Fungizid). Wo die Krankheit steckt, steht im DLC-Code, den niemand lesen kann;
--             die Mod sucht deshalb nach Namen wie disease/sick/fungi/infect/health und schreibt in die Live-Datei unter
--             <orchards>, was sie an jeder Plantage gefunden hat (Diagnose für die nächste Version).
-- Ballen      hängen einzeln im Objektsystem des Spiels (itemSystem). Gezählt werden echte Ballen ohne Auftragsballen, je Hof
--             und Ware, dazu die gärenden. Ist ein Ballen fertig gegoren, merkt sich die Mod ihn, bis jemand die Meldung
--             abhakt oder der Ballen weg ist. Ballenlager (Objektlager) melden sich wie Silos, wenn sie fast voll sind.
-- Tracker     zeigen Werte im Overlay, ohne Aufgabe zu sein. Der Server sammelt alle 10 Sekunden, was sich verfolgen lässt;
--             jeder Spieler schickt seine Auswahl (HubLinkTrackEvent), der Server hängt genau diese Werte an die Liste fürs
--             Overlay (src 4). Den Katalog zum Auswählen bekommt nur, wer ihn im Optionsmenü anfragt.

local U = FarmingHubLive.U

FarmingHubLive.SLOW_MS = 120000
FarmingHubLive.TRACK_MAX = 8
FarmingHubLive.TRACK_SEND = 30
FarmingHubLive.baleFerm = {}
FarmingHubLive.baleReady = {}
FarmingHubLive.trackSel = {}
FarmingHubLive.trackers = {}

local SICK = { "disease", "sick", "fungi", "fungus", "infect", "blight", "pest", "health" }
local function sickWord(k)
    if type(k) ~= "string" then
        return nil
    end
    local l = string.lower(k)
    for _, w in ipairs(SICK) do
        if string.find(l, w, 1, true) then
            return w
        end
    end
    return nil
end

local function farmOk(farm)
    if type(farm) ~= "number" or farm < 1 or farm > 8 then
        return false
    end
    if g_farmManager ~= nil and g_farmManager.getFarmById ~= nil and g_farmManager:getFarmById(farm) == nil then
        return false
    end
    return true
end

local function ownerOf(o)
    local f = 0
    pcall(function()
        f = o:getOwnerFarmId() or 0
    end)
    return f
end

local function placeables()
    return (g_currentMission ~= nil and g_currentMission.placeableSystem ~= nil and g_currentMission.placeableSystem.placeables) or {}
end

local function nameOfPlaceable(p)
    return (p.getName ~= nil and tostring(p:getName() or "")) or ""
end

local function fillOfFruit(index)
    local name = nil
    pcall(function()
        name = U.fillName(g_fruitTypeManager:getFillTypeIndexByFruitTypeIndex(index))
    end)
    return name
end

local function pctOf(part, total)
    if total == nil or total <= 0 then
        return 0
    end
    return part / total * 100
end

local function cut(s, n)
    s = tostring(s or "")
    if #s > n then
        s = string.sub(s, 1, n)
    end
    return s
end

-- ---------- Plantagen ----------
-- Spezialisierung der Plantage: spec_vine (Grundspiel) oder eine des DLC, z. B. „spec_pdlc_beansAndAlpacasPack.orchard“.
-- Ab 3.9 reicht der Name (orchard/vine); die Felder dafür sucht fruitOf/nodesOf.
local function orchardKey(k)
    if type(k) ~= "string" or string.sub(k, 1, 5) ~= "spec_" then
        return false
    end
    local l = string.lower(k)
    return string.find(l, "orchard", 1, true) ~= nil or string.find(l, "vine", 1, true) ~= nil or string.find(l, "plantation", 1, true) ~= nil
end

function FarmingHubLive.orchardSpec(p)
    if type(p.spec_vine) == "table" then
        return p.spec_vine, "spec_vine"
    end
    local named = nil
    for k, v in pairs(p) do
        if type(k) == "string" and string.sub(k, 1, 5) == "spec_" and type(v) == "table" then
            if type(v.fruitType) == "table" and type(v.nodes) == "table" then
                return v, k
            end
            if orchardKey(k) then
                named = named or { v, k }
            end
        end
    end
    if named ~= nil then
        return named[1], named[2]
    end
    return nil, nil
end

-- Fruchtart einer Plantage: fruitType, eine Nummer (fruitTypeIndex …) oder irgendeine Tabelle, die wie eine Frucht aussieht
local function isFruit(v)
    return type(v) == "table" and type(v.index) == "number" and (v.minHarvestingGrowthState ~= nil or v.numGrowthStates ~= nil)
end
function FarmingHubLive.fruitOf(spec)
    if spec == nil then
        return nil
    end
    if isFruit(spec.fruitType) then
        return spec.fruitType
    end
    for k, v in pairs(spec) do
        if isFruit(v) then
            return v
        end
        if type(k) == "string" and type(v) == "number" and string.find(string.lower(k), "fruit", 1, true) and g_fruitTypeManager ~= nil then
            local ok, d = pcall(g_fruitTypeManager.getFruitTypeByIndex, g_fruitTypeManager, v)
            if ok and isFruit(d) then
                return d
            end
        end
    end
    return nil
end

-- Pflanzreihen: spec.nodes oder eine Tabelle, deren Einträge growthValues haben
function FarmingHubLive.nodesOf(spec)
    if spec == nil then
        return nil
    end
    if type(spec.nodes) == "table" then
        return spec.nodes
    end
    for _, v in pairs(spec) do
        if type(v) == "table" then
            for _, e in pairs(v) do
                if type(e) == "table" and (type(e.growthValues) == "table" or type(e.sections) == "table") then
                    return v
                end
                break
            end
        end
    end
    return nil
end

local function looksLikeOrchard(p)
    if p.spec_productionPoint ~= nil then
        return false
    end
    for k in pairs(p) do
        if orchardKey(k) then
            return true
        end
    end
    return false
end

-- Fläche je Wachstumsstufe (ohne Stufe 0 = nichts gepflanzt)
local function addAreas(areas, values)
    local total = 0
    for st, a in pairs(values or {}) do
        if type(st) == "number" and st > 0 and type(a) == "number" and a > 0 then
            areas[st] = (areas[st] or 0) + a
            total = total + a
        end
    end
    return total
end

function FarmingHubLive.orchardAreas(spec)
    local areas, total = {}, 0
    local nodes = FarmingHubLive.nodesOf(spec) or {}
    local fruit = FarmingHubLive.fruitOf(spec)
    for _, data in pairs(nodes) do
        if type(data) == "table" then
            for _, gv in pairs(data.growthValues or {}) do
                if type(gv) == "table" then
                    total = total + addAreas(areas, gv.values)
                end
            end
        end
    end
    if total > 0 then
        return areas, total, "cache"
    end
    -- Noch nichts zwischengespeichert (z. B. Server ohne Grafik): selbst nachmessen wie PlaceableVine:updateVineNode
    if FSDensityMapUtil == nil or FSDensityMapUtil.updateVineAreaValues == nil or fruit == nil then
        return areas, 0, "none"
    end
    local top = math.min(31, math.floor(2 ^ (fruit.numStateChannels or 4)) - 1)
    for _, data in pairs(nodes) do
        if type(data) == "table" then
            for _, sec in pairs(data.sections or {}) do
                if type(sec) == "table" and #sec >= 6 then
                    local values = {}
                    for st = 0, top do
                        values[st] = 0
                    end
                    if pcall(FSDensityMapUtil.updateVineAreaValues, fruit.index, sec[1], sec[2], sec[3], sec[4], sec[5], sec[6], values) then
                        total = total + addAreas(areas, values)
                    end
                end
            end
        end
    end
    return areas, total, "density"
end

-- Krank: zuerst eine Wachstumsstufe „krank“ der Frucht, dann ein Wert an der Plantage, dann eine get…-Funktion
local function sickOf(p, spec, desc, areas, total)
    if desc ~= nil and total > 0 then
        for k, v in pairs(desc) do
            local w = sickWord(k)
            if w ~= nil and w ~= "health" then
                local states = {}
                if type(v) == "number" then
                    table.insert(states, v)
                elseif type(v) == "table" then
                    for a, b in pairs(v) do
                        if type(b) == "number" then
                            table.insert(states, b)
                        elseif type(a) == "number" and b == true then
                            table.insert(states, a)
                        end
                    end
                end
                if #states > 0 then
                    local a = 0
                    for _, st in ipairs(states) do
                        a = a + (areas[st] or 0)
                    end
                    return pctOf(a, total), "fruit." .. k
                end
            end
        end
    end
    for _, t in ipairs({ { spec, "spec." }, { p, "p." } }) do
        for k, v in pairs(t[1] or {}) do
            local w = sickWord(k)
            if w ~= nil and type(v) == "number" then
                local pct = v <= 1 and v * 100 or v
                if pct >= 0 and pct <= 100 then
                    if w == "health" then
                        pct = 100 - pct
                    end
                    return pct, t[2] .. k
                end
            end
        end
    end
    for k, v in pairs(p) do
        local w = sickWord(k)
        if w ~= nil and type(v) == "function" and string.sub(k, 1, 3) == "get" then
            local ok, r = pcall(v, p)
            if ok and type(r) == "number" then
                local pct = r <= 1 and r * 100 or r
                if pct >= 0 and pct <= 100 then
                    if w == "health" then
                        pct = 100 - pct
                    end
                    return pct, "p:" .. k .. "()"
                end
            end
        end
    end
    return nil, nil
end

-- Diagnose: was die Mod an der Plantage sieht (Namen, keine Inhalte), höchstens 1500 Zeichen je Teil
local function keyList(t, filter)
    local out = {}
    for k, v in pairs(t or {}) do
        if type(k) == "string" and (filter == nil or filter(k, v)) then
            local tv = type(v)
            local s = k .. ":" .. string.sub(tv, 1, 1)
            if tv == "number" or tv == "boolean" then
                s = k .. "=" .. tostring(v)
            end
            table.insert(out, s)
        end
    end
    table.sort(out)
    return cut(table.concat(out, " "), 1500)
end

-- Eine Ebene tiefer: je Tabelle der Spezialisierung ihre Felder, bei Listen die des ersten Eintrags (ab 3.9)
local function deepList(spec)
    local out = {}
    for k, v in pairs(spec) do
        if type(k) == "string" and type(v) == "table" then
            local first = nil
            for _, e in pairs(v) do
                first = e
                break
            end
            local inner = keyList(v)
            if inner == "" and type(first) == "table" then
                inner = "[" .. keyList(first) .. "]"
            elseif type(first) == "table" then
                inner = inner .. " [" .. keyList(first) .. "]"
            end
            table.insert(out, k .. "{" .. cut(inner, 300) .. "}")
        end
    end
    table.sort(out)
    return cut(table.concat(out, " "), 3000)
end

-- Funktionen der Klasse (über die Metatabelle), deren Name nach Plantage, Wachstum oder Krankheit klingt
local function methodList(p)
    local out, seen = {}, {}
    local mt = getmetatable(p)
    local depth = 0
    while mt ~= nil and depth < 8 do
        local idx = rawget(mt, "__index")
        if type(idx) ~= "table" then
            break
        end
        for k, v in pairs(idx) do
            if type(k) == "string" and type(v) == "function" and not seen[k] then
                local l = string.lower(k)
                if sickWord(k) ~= nil or string.find(l, "orchard", 1, true) or string.find(l, "growth", 1, true) or string.find(l, "spray", 1, true)
                    or string.find(l, "fungi", 1, true) or string.find(l, "tree", 1, true) then
                    seen[k] = true
                    table.insert(out, k)
                end
            end
        end
        mt = getmetatable(idx)
        depth = depth + 1
    end
    table.sort(out)
    return cut(table.concat(out, " "), 1500)
end

local function diagOf(p, spec, desc, areas)
    local d = {}
    d.specs = keyList(p, function(k)
        return string.sub(k, 1, 5) == "spec_"
    end)
    if spec ~= nil then
        d.spec = keyList(spec)
        d.deep = deepList(spec)
    end
    d.methods = methodList(p)
    -- ab 3.10: eigene Felder der Plantage (ohne spec_) und Funktionen direkt am Objekt
    d.fields = keyList(p, function(k, v)
        return string.sub(k, 1, 5) ~= "spec_" and type(v) ~= "function"
    end)
    d.funcs = keyList(p, function(k, v)
        if type(v) ~= "function" then
            return false
        end
        local l = string.lower(k)
        return sickWord(k) ~= nil or string.find(l, "orchard", 1, true) ~= nil or string.find(l, "tree", 1, true) ~= nil or string.find(l, "growth", 1, true) ~= nil
            or string.find(l, "spray", 1, true) ~= nil or string.find(l, "fung", 1, true) ~= nil or string.find(l, "state", 1, true) ~= nil or string.find(l, "rail", 1, true) ~= nil
            or string.find(l, "worker", 1, true) ~= nil or string.find(l, "row", 1, true) ~= nil
    end)
    if desc ~= nil then
        d.fruit = keyList(desc, function(k, v)
            local l = string.lower(k)
            return (type(v) == "number" or type(v) == "table" or type(v) == "boolean") and (string.find(l, "state", 1, true) or sickWord(k) ~= nil or string.find(l, "num", 1, true))
        end)
    end
    d.sick = keyList(p, function(k)
        return sickWord(k) ~= nil
    end)
    local st = {}
    for s, a in pairs(areas or {}) do
        table.insert(st, s)
    end
    table.sort(st)
    for i, s in ipairs(st) do
        st[i] = string.format("%d:%.0f", s, areas[s])
    end
    d.states = table.concat(st, " ")
    return d
end

-- Alle Plantagen, höchstens alle 2 Minuten neu gelesen
function FarmingHubLive:readOrchards()
    if self.orchardCache ~= nil and g_time - (self.orchardT or 0) < FarmingHubLive.SLOW_MS then
        return self.orchardCache
    end
    self.orchardT = g_time
    local list, objs = {}, {}
    for _, p in ipairs(placeables()) do
        local spec, specName = FarmingHubLive.orchardSpec(p)
        if spec ~= nil or looksLikeOrchard(p) then
            local o = { uid = U.uidOf(p), farm = ownerOf(p), name = nameOfPlaceable(p), file = p.configFileName, custom = p.nameCustom, specName = specName or "" }
            if FarmingHubLive.posOfNode ~= nil then
                o.x, o.z = FarmingHubLive.posOfNode(p.rootNode)
            end
            -- Plantagen des DLC gehören im Spiel niemandem (0); es zählt, wem das Grundstück gehört (ab 3.9)
            o.pos = string.format("x=%s z=%s", tostring(o.x), tostring(o.z))
            if (o.farm or 0) < 1 and o.x ~= nil and g_farmlandManager ~= nil then
                pcall(function()
                    local f = g_farmlandManager:getOwnerIdAtWorldPosition(o.x, o.z)
                    local land = g_farmlandManager.getFarmlandIdAtWorldPosition ~= nil and g_farmlandManager:getFarmlandIdAtWorldPosition(o.x, o.z) or nil
                    o.pos = string.format("%s farmland=%s owner=%s", o.pos, tostring(land), tostring(f))
                    if type(f) == "number" and f > 0 then
                        o.farm = f
                    end
                end)
            end
            local desc, areas, total = nil, {}, 0
            local fruit = FarmingHubLive.fruitOf(spec)
            if fruit ~= nil then
                local idx = fruit.index
                pcall(function()
                    desc = g_fruitTypeManager:getFruitTypeByIndex(idx)
                end)
                desc = desc or fruit
                o.fruit = U.fruitName(idx)
                o.fill = fillOfFruit(idx)
                o.fruitTitle = U.fruitTitle(idx)
                o.how = "none"
                U.try("Plantage messen", function()
                    areas, total, o.how = FarmingHubLive.orchardAreas(spec)
                end)
                o.total = total
                if total > 0 then
                    local lo = desc.minHarvestingGrowthState
                    local hi = desc.maxHarvestingGrowthState or lo
                    local ripe = 0
                    if lo ~= nil then
                        for s = lo, hi do
                            ripe = ripe + (areas[s] or 0)
                        end
                    end
                    o.ripe = pctOf(ripe, total)
                    o.withered = desc.witheredState ~= nil and pctOf(areas[desc.witheredState] or 0, total) or 0
                    local best, bestA = nil, -1
                    for s, a in pairs(areas) do
                        if a > bestA then
                            best, bestA = s, a
                        end
                    end
                    o.state = best
                    o.maxState = desc.numGrowthStates
                end
                U.try("Plantage krank", function()
                    o.sick, o.sickFrom = sickOf(p, spec, desc, areas, total)
                end)
            end
            U.try("Plantage Diagnose", function()
                o.diag = diagOf(p, spec, desc, areas)
                o.diag.pos = o.pos
            end)
            table.insert(list, o)
            table.insert(objs, { p = p, o = o })
        end
    end
    -- ab 3.11: Feldzustand an den Baumreihen wie im Feld-Infokasten des Spiels (HubLinkFieldInfo.lua)
    if FarmingHubLive.orchardProbe ~= nil then
        U.try("Plantage Feldzustand", function()
            self:orchardProbe(objs)
        end)
    end
    self.orchardCache = list
    return list
end

function FarmingHubLive:checkOrchards(found)
    for _, o in ipairs(self:readOrchards()) do
        if farmOk(o.farm) and self:farm(o.farm).orchard ~= false and (o.total or 0) > 0 then
            local base = { farm = o.farm, uid = o.uid, name = o.name, file = o.file, custom = o.custom, fill = o.fill, fillTitle = o.fruitTitle, x = o.x, z = o.z }
            local function put(kind, pct, limit, sev)
                local open = self:wasOpen(kind, o.farm, o.uid, kind)
                if pct ~= nil and pct >= (open and limit / 2 or limit) then
                    local p = { kind = kind, part = kind, pct = pct, sev = sev }
                    for k, v in pairs(base) do
                        p[k] = v
                    end
                    self:add(found, p)
                end
            end
            put("orchardHarvest", o.ripe, 10, 2)
            put("orchardCut", o.withered, 10, 2)
            put("orchardSpray", o.sick, 1, 3)
        end
    end
end

-- ---------- Ballen ----------
local function isBale(o)
    if type(o) ~= "table" then
        return false
    end
    if Bale ~= nil and type(o.isa) == "function" then
        local ok, r = pcall(o.isa, o, Bale)
        if ok then
            return r == true
        end
    end
    return o.fermentingPercentage ~= nil and o.wrappingState ~= nil and o.fillType ~= nil
end

-- Jedes Objekt im Objektsystem einmal (das Spiel hält sie je nach Stand als Schlüssel oder als { item = … })
local function eachItem(fn)
    local sys = g_currentMission ~= nil and g_currentMission.itemSystem or nil
    if sys == nil then
        return
    end
    local seen = {}
    local function visit(o)
        if type(o) == "table" and not seen[o] then
            seen[o] = true
            fn(o)
        end
    end
    for _, name in ipairs({ "itemsToSave", "items" }) do
        local t = sys[name]
        if type(t) == "table" then
            for k, v in pairs(t) do
                if type(k) == "table" then
                    visit(k)
                end
                if type(v) == "table" then
                    visit(v.item ~= nil and v.item or v)
                end
            end
        end
    end
end

local function baleId(o)
    local id = nil
    pcall(function()
        id = o.uniqueId or (o.getUniqueId ~= nil and o:getUniqueId()) or nil
    end)
    return tostring(id or o)
end

-- Ballen je Hof und Ware, höchstens alle 2 Minuten neu gezählt
function FarmingHubLive:readBales()
    if self.baleCache ~= nil and g_time - (self.baleT or 0) < FarmingHubLive.SLOW_MS then
        return self.baleCache
    end
    self.baleT = g_time
    local farms, stores, present, n = {}, {}, {}, 0
    local function slot(farm, fill)
        farms[farm] = farms[farm] or {}
        local s = farms[farm][fill]
        if s == nil then
            s = { fill = fill, count = 0, liters = 0, ferm = 0, fermPct = 0, stored = 0 }
            farms[farm][fill] = s
        end
        return s
    end
    eachItem(function(o)
        if not isBale(o) or o.isMissionBale == true then
            return
        end
        local farm = ownerOf(o)
        if not farmOk(farm) then
            return
        end
        n = n + 1
        local fill = U.fillName(o.fillType or U.call(o, { "getFillType" })) or "UNKNOWN"
        local s = slot(farm, fill)
        s.count = s.count + 1
        s.liters = s.liters + (U.call(o, { "getFillLevel" }) or o.fillLevel or 0)
        local id = baleId(o)
        present[id] = true
        if o.isFermenting == true then
            s.ferm = s.ferm + 1
            s.fermPct = s.fermPct + (U.call(o, { "getFermentingPercentage" }) or o.fermentingPercentage or 0) * 100
            self.baleFerm[id] = farm
        elseif self.baleFerm[id] ~= nil then
            -- eben fertig gegoren
            self.baleReady[farm] = self.baleReady[farm] or {}
            self.baleReady[farm][id] = fill
            self.baleFerm[id] = nil
        end
    end)
    for id in pairs(self.baleFerm) do
        if not present[id] then
            self.baleFerm[id] = nil
        end
    end
    for _, ids in pairs(self.baleReady) do
        for id in pairs(ids) do
            if not present[id] then
                ids[id] = nil
            end
        end
    end
    -- Ballenlager: gelagerte Ballen zählen mit
    for _, p in ipairs(placeables()) do
        local spec = p.spec_objectStorage
        local farm = ownerOf(p)
        if spec ~= nil and farmOk(farm) then
            local st = { farm = farm, uid = U.uidOf(p), name = nameOfPlaceable(p), file = p.configFileName, custom = p.nameCustom, count = spec.numStoredObjects or 0,
                cap = spec.capacity or 0, fills = {} }
            for _, info in ipairs(spec.objectInfos or {}) do
                local ob = info.objects ~= nil and info.objects[1] or nil
                local at = type(ob) == "table" and (ob.baleAttributes or ob.attributes or ob) or {}
                local fill = U.fillName(at.fillType or at.fillTypeIndex) or "UNKNOWN"
                local cnt = info.numObjects or 1
                st.fills[fill] = (st.fills[fill] or 0) + cnt
                local s = slot(farm, fill)
                s.stored = s.stored + cnt
                s.count = s.count + cnt
                s.liters = s.liters + cnt * (type(at.fillLevel) == "number" and at.fillLevel or 0)
            end
            table.insert(stores, st)
        end
    end
    self.baleCache = { farms = farms, stores = stores, n = n }
    return self.baleCache
end

function FarmingHubLive:checkBales(found)
    local b = self:readBales()
    for farm, ids in pairs(self.baleReady) do
        local key = string.format("balesReady:%d:bales:silage", farm)
        if self.seen[key] then
            -- abgehakt: die gemeldeten Ballen sind erledigt
            self.baleReady[farm] = {}
        elseif farmOk(farm) and self:farm(farm).bales ~= false then
            local count, fill = 0, nil
            for _, f in pairs(ids) do
                count = count + 1
                fill = fill or f
            end
            if count > 0 then
                self:add(found, { kind = "balesReady", farm = farm, uid = "bales", part = "silage", name = "", fill = fill, fillTitle = U.fillTitle(g_fillTypeManager ~= nil and
                    g_fillTypeManager:getFillTypeIndexByName(fill or "") or nil), sev = 2, level = count, file = "", custom = "" })
            end
        end
    end
    for _, st in ipairs(b.stores) do
        local cfg = self:farm(st.farm)
        if cfg.silo and st.cap > 0 then
            local pct = pctOf(st.count, st.cap)
            local open = self:wasOpen("objects", st.farm, st.uid, "objects")
            if pct >= cfg.siloPct - (open and 10 or 0) then
                self:add(found, { kind = "objects", farm = st.farm, uid = st.uid, name = st.name, part = "objects", file = st.file, custom = st.custom, sev = pct >= 99 and 3 or 2,
                    level = st.count, cap = st.cap, pct = pct })
            end
        end
    end
end

-- ---------- Tracker ----------
-- Werte als kurze Zeichenkette (der Spieler formatiert sie in seiner Sprache): Teile mit „;“, Felder mit „:“
local function clean(s)
    return (string.gsub(tostring(s or ""), "[;:]", " "))
end

local function needPerHour(point)
    local need = {}
    local active = point.activeProductions or {}
    local shared = point.sharedThroughputCapacity ~= false and #active > 1
    for _, prod in ipairs(active) do
        local cph = U.cyclesPerHour(prod)
        if cph ~= nil and shared then
            cph = cph / #active
        end
        for _, i in ipairs(prod.inputs or {}) do
            local ft = i.type or i.fillTypeIndex
            if ft ~= nil and cph ~= nil then
                need[ft] = (need[ft] or 0) + (i.amount or 0) * cph
            end
        end
    end
    return need
end

function FarmingHubLive:trackProduction(out, base, point)
    local storage = point.storage
    if storage == nil then
        return
    end
    local ins, outs, order = {}, {}, {}
    for _, prod in ipairs(point.productions or point.activeProductions or {}) do
        for _, i in ipairs(prod.inputs or {}) do
            local ft = i.type or i.fillTypeIndex
            if ft ~= nil and not ins[ft] then
                ins[ft] = true
                table.insert(order, { ft, "i" })
            end
        end
        for _, o in ipairs(prod.outputs or {}) do
            local ft = o.type or o.fillTypeIndex
            if ft ~= nil and not outs[ft] and not ins[ft] and not o.sellDirectly then
                outs[ft] = true
                table.insert(order, { ft, "o" })
            end
        end
    end
    local need = needPerHour(point)
    local parts, low = {}, nil
    for _, it in ipairs(order) do
        local name = U.fillName(it[1])
        if name ~= nil and #parts < 8 then
            local level = U.call(storage, { "getFillLevel" }, it[1]) or 0
            local cap = U.call(storage, { "getCapacity" }, it[1]) or 0
            local pct = pctOf(level, cap)
            local h = (it[2] == "i" and (need[it[1]] or 0) > 0) and level / need[it[1]] or -1
            table.insert(parts, string.format("%s:%s:%d:%.1f", it[2], name, math.floor(pct + 0.5), h))
            if it[2] == "i" and (low == nil or pct < low) then
                low = pct
            end
        end
    end
    if #parts > 0 then
        out["tr:prod:" .. base.uid] = { kind = "prod", farm = base.farm, uid = base.uid, name = base.name, file = base.file, custom = base.custom,
            sub = table.concat(parts, ";"), pct = low or -1 }
    end
end

function FarmingHubLive:trackStall(out, base, p)
    local parts = {}
    local animals = U.call(p, { "getNumOfAnimals" })
    if type(animals) == "number" then
        table.insert(parts, "a:" .. tostring(math.floor(animals)))
    end
    local total, cap = 0, 0
    for _, info in ipairs(U.call(p, { "getFoodInfos" }) or {}) do
        total = total + (type(info.value) == "number" and info.value or 0)
        if type(info.capacity) == "number" and info.capacity > cap then
            cap = info.capacity
        end
    end
    local low = nil
    if cap > 0 then
        low = pctOf(total, cap)
        table.insert(parts, string.format("f:%d", math.floor(low + 0.5)))
    end
    for _, info in ipairs(U.call(p, { "getConditionInfos" }) or {}) do
        if type(info.ratio) == "number" and #parts < 8 then
            local pct = info.ratio * 100
            table.insert(parts, string.format("c:%s:%d:%s", clean(info.title), math.floor(pct + 0.5), info.invertedBar and "1" or "0"))
            if not info.invertedBar and (low == nil or pct < low) then
                low = pct
            end
        end
    end
    if #parts > 0 then
        out["tr:stall:" .. base.uid] = { kind = "stall", farm = base.farm, uid = base.uid, name = base.name, file = base.file, custom = base.custom,
            sub = table.concat(parts, ";"), pct = low or -1 }
    end
end

function FarmingHubLive:trackSilo(out, base, p)
    local levels, total, cap = {}, 0, 0
    for _, s in ipairs((p.spec_silo or {}).storages or {}) do
        for ft, level in pairs(s.fillLevels or {}) do
            if level > 0 then
                levels[ft] = (levels[ft] or 0) + level
                total = total + level
            end
        end
        if s.capacities ~= nil and next(s.capacities) ~= nil then
            for _, c in pairs(s.capacities) do
                cap = cap + c
            end
        else
            cap = cap + (s.capacity or 0)
        end
    end
    local list = {}
    for ft, l in pairs(levels) do
        table.insert(list, { ft, l })
    end
    table.sort(list, function(a, b)
        return a[2] > b[2]
    end)
    local parts = {}
    for i = 1, math.min(5, #list) do
        local name = U.fillName(list[i][1])
        if name ~= nil then
            table.insert(parts, string.format("%s:%d", name, math.floor(list[i][2] + 0.5)))
        end
    end
    out["tr:silo:" .. base.uid] = { kind = "silo", farm = base.farm, uid = base.uid, name = base.name, file = base.file, custom = base.custom,
        sub = table.concat(parts, ";"), pct = cap > 0 and pctOf(total, cap) or -1, level = total, cap = cap }
end

-- Alles, was sich verfolgen lässt, für alle Höfe (alle 10 Sekunden; Felder, Plantagen und Ballen aus ihren 2-Minuten-Speichern)
function FarmingHubLive:collectTrackers()
    local out = {}
    for _, p in ipairs(placeables()) do
        local farm = ownerOf(p)
        if farmOk(farm) then
            local base = { farm = farm, uid = U.uidOf(p), name = nameOfPlaceable(p), file = p.configFileName, custom = p.nameCustom }
            local point = p.spec_productionPoint ~= nil and p.spec_productionPoint.productionPoint or nil
            if point ~= nil then
                U.try("Tracker Produktion", self.trackProduction, self, out, base, point)
            elseif p.spec_husbandryAnimals ~= nil then
                U.try("Tracker Stall", self.trackStall, self, out, base, p)
            elseif p.spec_silo ~= nil then
                U.try("Tracker Silo", self.trackSilo, self, out, base, p)
            end
        end
    end
    for _, f in ipairs(self:readFields()) do
        if farmOk(f.farm) then
            out["tr:field:" .. tostring(f.id)] = { kind = "field", farm = f.farm, uid = tostring(f.id), name = tostring(f.id), fill = f.fruit ~= nil and (fillOfFruit(f.fruitIndex) or f.fruit) or "",
                fillTitle = f.fruitTitle or "",
                level = type(f.growth) == "number" and f.growth or -1, cap = type(f.maxGrowth) == "number" and f.maxGrowth or -1, sev = f.ripe and 1 or 0, sub = clean(f.ground or "") }
        end
    end
    for _, o in ipairs(self:readOrchards()) do
        if farmOk(o.farm) and o.fruit ~= nil then
            out["tr:orchard:" .. o.uid] = { kind = "orchard", farm = o.farm, uid = o.uid, name = o.name, file = o.file, custom = o.custom, fill = o.fill or "", fillTitle = o.fruitTitle or "",
                pct = o.ripe or -1, sub = string.format("r:%d;w:%d;s:%d;g:%d:%d", math.floor((o.ripe or 0) + 0.5), math.floor((o.withered or 0) + 0.5), o.sick ~= nil and math.floor(o.sick + 0.5) or -1,
                    o.state or -1, o.maxState or -1) }
        end
    end
    local b = self:readBales()
    for farm, fills in pairs(b.farms) do
        local parts, total = {}, 0
        for _, fill in ipairs(U.sortedKeys(fills)) do
            local s = fills[fill]
            total = total + s.count
            if #parts < 6 then
                table.insert(parts, string.format("%s:%d:%d:%d", fill, s.count, s.ferm, s.ferm > 0 and math.floor(s.fermPct / s.ferm + 0.5) or 0))
            end
        end
        out["tr:bales:" .. tostring(farm)] = { kind = "bales", farm = farm, uid = "bales", name = "", sub = table.concat(parts, ";"), level = total }
    end
    for _, st in ipairs(b.stores) do
        local parts = {}
        for _, fill in ipairs(U.sortedKeys(st.fills)) do
            table.insert(parts, string.format("%s:%d", fill, st.fills[fill]))
        end
        out["tr:store:" .. st.uid] = { kind = "store", farm = st.farm, uid = st.uid, name = st.name, file = st.file, custom = st.custom, sub = table.concat(parts, ";"),
            level = st.count, cap = st.cap, pct = st.cap > 0 and pctOf(st.count, st.cap) or -1 }
    end
    self.trackers = out
    return out
end

-- Auswahl eines Spielers (who = Verbindung, beim Server/Einzelspieler "local"); alte Auswahlen verfallen nach 30 Minuten
function FarmingHubLive:setTrack(who, keys)
    local set = {}
    for i, k in ipairs(keys or {}) do
        if i <= FarmingHubLive.TRACK_MAX then
            set[k] = true
        end
    end
    self.trackSel[who] = { keys = set, t = g_time }
    self:publish()
end

function FarmingHubLive:trackedKeys()
    local union, n = {}, 0
    for who, sel in pairs(self.trackSel) do
        if who ~= "local" and g_time - (sel.t or 0) > 1800000 then
            self.trackSel[who] = nil
        else
            for k in pairs(sel.keys) do
                if not union[k] and n < FarmingHubLive.TRACK_SEND then
                    union[k] = true
                    n = n + 1
                end
            end
        end
    end
    return union
end

-- Einträge fürs Overlay (src 4)
function FarmingHubLive:trackView()
    local list = {}
    for _, key in ipairs(U.sortedKeys(self:trackedKeys())) do
        local t = self.trackers[key]
        if t ~= nil then
            local file = t.file ~= nil and tostring(t.file) or ""
            if file ~= "" and NetworkUtil ~= nil and NetworkUtil.convertToNetworkFilename ~= nil then
                file = NetworkUtil.convertToNetworkFilename(file)
            end
            table.insert(list, { key = key, src = 4, farm = t.farm, sev = t.sev or 0, kind = t.kind, uid = tostring(t.uid or ""), name = tostring(t.name or ""), fill = t.fill or "",
                fillTitle = tostring(t.fillTitle or ""), title = "", sub = t.sub or "", pct = type(t.pct) == "number" and t.pct or -1, hours = -1,
                level = type(t.level) == "number" and t.level or -1, cap = type(t.cap) == "number" and t.cap or -1, file = file, custom = tostring(t.custom or "") })
        end
    end
    return list
end

-- Katalog eines Hofs zum Auswählen (ohne Werte)
local KIND_ORDER = { prod = 1, stall = 2, silo = 3, store = 4, bales = 5, orchard = 6, field = 7 }
function FarmingHubLive:catalog(farm)
    local list = {}
    for key, t in pairs(self.trackers) do
        if t.farm == farm then
            local file = t.file ~= nil and tostring(t.file) or ""
            if file ~= "" and NetworkUtil ~= nil and NetworkUtil.convertToNetworkFilename ~= nil then
                file = NetworkUtil.convertToNetworkFilename(file)
            end
            table.insert(list, { key = key, kind = t.kind, name = tostring(t.name or ""), fill = t.fill or "", file = file, custom = tostring(t.custom or "") })
        end
    end
    table.sort(list, function(a, b)
        local ka, kb = KIND_ORDER[a.kind] or 9, KIND_ORDER[b.kind] or 9
        if ka ~= kb then
            return ka < kb
        end
        if a.kind == "field" then
            return (tonumber(a.name) or 0) < (tonumber(b.name) or 0)
        end
        return (a.custom ~= "" and a.custom or a.name) < (b.custom ~= "" and b.custom or b.name)
    end)
    while #list > 200 do
        table.remove(list)
    end
    return list
end

-- ---------- Live-Datei ----------
function FarmingHubLive:writeWatchData(xml, r)
    local b = self:readBales()
    local n = 0
    for _, farm in ipairs(U.sortedKeys(b.farms)) do
        local k = string.format("%s.bales.farm(%d)", r, n)
        n = n + 1
        xml:setInt(k .. "#id", farm)
        local j = 0
        for _, fill in ipairs(U.sortedKeys(b.farms[farm])) do
            local s = b.farms[farm][fill]
            local bk = string.format("%s.bale(%d)", k, j)
            j = j + 1
            xml:setString(bk .. "#fillType", fill)
            xml:setInt(bk .. "#count", s.count)
            xml:setString(bk .. "#liters", U.num(s.liters, 0))
            xml:setInt(bk .. "#fermenting", s.ferm)
            if s.ferm > 0 then
                xml:setString(bk .. "#fermentPct", U.num(s.fermPct / s.ferm, 0))
            end
            xml:setInt(bk .. "#stored", s.stored)
        end
    end
    local orchards = self:readOrchards()
    if #orchards > 0 and FarmingHubLive.missionKeys ~= nil then
        xml:setString(r .. ".orchards#missionKeys", FarmingHubLive.missionKeys())
    end
    for i, o in ipairs(orchards) do
        local k = string.format("%s.orchards.orchard(%d)", r, i - 1)
        xml:setString(k .. "#uid", tostring(o.uid))
        xml:setInt(k .. "#farm", o.farm or 0)
        xml:setString(k .. "#name", tostring(o.name or ""))
        xml:setString(k .. "#file", tostring(o.file or ""))
        xml:setString(k .. "#spec", o.specName or "")
        if o.fruit ~= nil then
            xml:setString(k .. "#fruitType", o.fruit)
        end
        xml:setString(k .. "#measure", tostring(o.how or ""))
        xml:setString(k .. "#area", U.num(o.total or 0, 0))
        for _, a in ipairs({ { "ripe", o.ripe }, { "withered", o.withered }, { "sick", o.sick }, { "state", o.state }, { "maxState", o.maxState } }) do
            if type(a[2]) == "number" then
                xml:setString(k .. "#" .. a[1], U.num(a[2], 0))
            end
        end
        if o.sickFrom ~= nil then
            xml:setString(k .. "#sickFrom", o.sickFrom)
        end
        -- Diagnose, bis klar ist, wo das DLC die Krankheit führt
        for _, part in ipairs({ "states", "specs", "spec", "deep", "methods", "fruit", "sick", "fields", "funcs", "pos", "field" }) do
            if o.diag ~= nil and o.diag[part] ~= nil and o.diag[part] ~= "" then
                xml:setString(k .. ".debug#" .. part, o.diag[part])
            end
        end
    end
end
