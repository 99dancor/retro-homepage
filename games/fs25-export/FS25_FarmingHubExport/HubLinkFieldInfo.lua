-- FS25 Hub Link: Plantagen über den Feldzustand (ab Mod 3.11, ersetzt das Plantagen-Abbild aus 3.10)
--
-- Was 3.10 gezeigt hat: Die Plantagen des DLC (Bananen, Kaffee) speichern nur ihre Baumreihen (newFence/segment), Alter
-- und Preis. Krankheit, Wachstum und Spritzen liegen wie bei Feldern im Boden. „Fungizid nötig“ zeigt das Spiel im
-- Feld-Infokasten (PlayerHUDUpdater, dieselbe Stelle wie „Kalk nötig“; Additional Field Info hängt sich dort nur an).
--
-- Darum misst die Mod jetzt so wie der Infokasten:
--   1. Baumreihen je Plantage aus ihrem saveToXMLFile (nur im Speicher, keine Datei), alle 10 Minuten neu.
--   2. Je Reihe drei Punkte (¼, ½, ¾), an jedem FieldState.new():update(x, z) – derselbe Zustand, den der Infokasten liest.
--   3. An der Mitte jeder Reihe die field…-Funktionen des Infokastens mit einem stillen Kasten aufrufen. Schreibt eine davon
--      eine Zeile mit „Fungi…“ (Fungizid/Fungicide), ist die Reihe krank. Das ist genau die Anzeige des Spiels.
--   4. Findet sich so nichts, zählt ein Wert des Feldzustands mit disease/fung/infect/… im Namen über 0.
--   Reif/verdorrt kommt aus Frucht und Wachstumsstufe des Feldzustands, wenn die Plantage selbst nichts liefert.
--
-- Diagnose (bis die Erkennung im Spiel bestätigt ist):
--   Server: modSettings/FS25_FarmingHubExport/<Spielstand>/hubLinkFieldInfo.xml – je Plantage die Verteilung aller Werte
--           des Feldzustands und die Zeilen, die der Infokasten dort schreiben würde, dazu die Spieltexte mit „fungi“.
--   Jeder Spieler: modSettings/FS25_FarmingHubExport/hubLinkHudLines.xml – jede Zeile, die der echte Infokasten beim
--           Herumlaufen zeigt, mit Funktion, Position und allen Werten des Feldzustands, sobald eine „Fungi“-Zeile dabei ist.

local U = FarmingHubLive.U

FarmingHubLive.ROWS_MS = 600000
FarmingHubLive.PROBE_MAX = 900
FarmingHubLive.HUD_FILE = "hubLinkHudLines.xml"
FarmingHubLive.HUD_WRITE_MS = 5000
FarmingHubLive.HUD_MAX = 40

local SICK_WORDS = { "disease", "fung", "infect", "sick", "blight", "pest", "mold", "mould" }
local function hasWord(name, words)
    local l = string.lower(tostring(name or ""))
    for _, w in ipairs(words) do
        if string.find(l, w, 1, true) then
            return true
        end
    end
    return false
end
-- „Fungizid nötig“ / „Fungicide required“; „nicht nötig“ / „not required“ zählt nicht
local function fungiLine(label, value)
    local l = string.lower(tostring(label or "") .. " " .. tostring(value or ""))
    if not string.find(l, "fungi", 1, true) then
        return false
    end
    return not (string.find(l, "nicht", 1, true) or string.find(l, " not ", 1, true) or string.find(l, "no need", 1, true))
end
FarmingHubLive.fungiLine = fungiLine

-- Zahlen und Schalter eines Feldzustands (ohne Funktionen und Tabellen)
local function scalars(state)
    local out = {}
    for k, v in pairs(state or {}) do
        local t = type(v)
        if type(k) == "string" and (t == "number" or t == "boolean") then
            out[k] = v
        end
    end
    return out
end

-- Funktionen des Infokastens, die eine Zeile zum Feld schreiben (fieldAddFarmland, fieldAdd…); DLC kann eigene anhängen
local function hudFunctions()
    local out = {}
    if PlayerHUDUpdater == nil then
        return out
    end
    for k, v in pairs(PlayerHUDUpdater) do
        if type(k) == "string" and type(v) == "function" and string.sub(k, 1, 5) == "field" then
            table.insert(out, k)
        end
    end
    table.sort(out)
    return out
end

-- Ein Kasten, der nichts zeichnet, sondern Zeilen sammelt
local function silentBox(lines)
    local box = {}
    box.addLine = function(_, label, value)
        table.insert(lines, { tostring(label or ""), tostring(value or "") })
    end
    return setmetatable(box, { __index = function()
        return function() end
    end })
end
local function silentSelf()
    return setmetatable({}, { __index = function(_, k)
        return PlayerHUDUpdater ~= nil and PlayerHUDUpdater[k] or nil
    end })
end

-- Spieltexte, die nach Fungizid klingen (einmal je Laden)
function FarmingHubLive.fungiTexts()
    if FarmingHubLive.fungiTextList ~= nil then
        return FarmingHubLive.fungiTextList
    end
    local out = {}
    pcall(function()
        local texts = g_i18n ~= nil and g_i18n.texts or nil
        for k, v in pairs(texts or {}) do
            if type(k) == "string" and (hasWord(k, { "fungi" }) or hasWord(v, { "fungi" })) then
                table.insert(out, k .. "=" .. string.sub(tostring(v), 1, 60))
            end
        end
    end)
    table.sort(out)
    FarmingHubLive.fungiTextList = string.sub(table.concat(out, " | "), 1, 2000)
    return FarmingHubLive.fungiTextList
end

-- Baumreihen einer Plantage aus ihrem Speichern (newFence/segment start/end), ohne etwas zu schreiben
local function vec(s)
    local x, _, z = string.match(tostring(s or ""), "^%s*(%-?[%d%.]+)%s+(%-?[%d%.]+)%s+(%-?[%d%.]+)")
    if x == nil then
        return nil
    end
    return tonumber(x), tonumber(z)
end
local function rowsOf(p)
    local rows = {}
    if XMLFile == nil or XMLFile.create == nil or p.saveToXMLFile == nil then
        return rows
    end
    local schema = Placeable ~= nil and Placeable.xmlSchemaSavegame or nil
    local xml = XMLFile.create("hubLinkRows", (getUserProfileAppPath and getUserProfileAppPath() or "") .. "hubLinkRows.xml", "placeables", schema)
    if xml == nil then
        return rows
    end
    local key = "placeables.placeable(0)"
    pcall(function()
        p:saveToXMLFile(xml, key, {})
    end)
    pcall(function()
        local i = 0
        while i < 1000 do
            local k = string.format("%s.newFence.segment(%d)", key, i)
            local s = xml:getString(k .. "#start")
            if s == nil then
                break
            end
            local x1, z1 = vec(s)
            local x2, z2 = vec(xml:getString(k .. "#end"))
            if x1 ~= nil and x2 ~= nil then
                table.insert(rows, { x1, z1, x2, z2 })
            end
            i = i + 1
        end
    end)
    xml:delete()
    return rows
end

local function count(map, key)
    map[key] = (map[key] or 0) + 1
end
local function dist(map, limit)
    local keys = {}
    for k, n in pairs(map) do
        table.insert(keys, { k, n })
    end
    table.sort(keys, function(a, b)
        return a[2] > b[2] or (a[2] == b[2] and a[1] < b[1])
    end)
    local s = {}
    for i, e in ipairs(keys) do
        if i <= (limit or 12) then
            table.insert(s, string.format("%s×%d", e[1], e[2]))
        end
    end
    if #keys > (limit or 12) then
        table.insert(s, string.format("+%d", #keys - (limit or 12)))
    end
    return table.concat(s, " ")
end

-- Eine Plantage vermessen: Anteil krank, reif, verdorrt; dazu die Diagnose
local function probe(o, rows, budget)
    if FieldState == nil or FieldState.new == nil or #rows == 0 then
        return nil
    end
    local fns = hudFunctions()
    local values, lines, fruits = {}, {}, {}
    -- hudRows: Reihen, an denen der Infokasten überhaupt etwas schreibt (läuft er auf dem Server nicht, zählt nur der Feldzustand)
    local n, sickHud, sickVal, sickKey, ripe, withered, hudRows = 0, 0, 0, nil, 0, 0, 0
    local step = math.max(1, math.ceil(#rows * 3 / math.max(3, budget)))
    for i = 1, #rows, step do
        local r = rows[i]
        for j, f in ipairs({ 0.25, 0.5, 0.75 }) do
            local x, z = r[1] + (r[3] - r[1]) * f, r[2] + (r[4] - r[2]) * f
            local st = FieldState.new()
            local ok = pcall(st.update, st, x, z)
            if ok then
                n = n + 1
                local sc = scalars(st)
                for k, v in pairs(sc) do
                    count(values, k .. "=" .. (type(v) == "number" and U.num(v, 2) or tostring(v)))
                end
                -- Wert mit Krankheitswort über 0 (nur Hilfsweg)
                for k, v in pairs(sc) do
                    if hasWord(k, SICK_WORDS) and ((type(v) == "number" and v > 0) or v == true) then
                        sickVal = sickVal + 1
                        sickKey = sickKey or k
                        break
                    end
                end
                local fi = sc.fruitTypeIndex or sc.lastFruitTypeIndex
                local gs = sc.growthState or sc.lastGrowthState
                if fi ~= nil and g_fruitTypeManager ~= nil then
                    local desc = g_fruitTypeManager:getFruitTypeByIndex(fi)
                    if desc ~= nil then
                        count(fruits, tostring(desc.name))
                        o.fruitIndex = o.fruitIndex or fi
                        if gs ~= nil and desc.minHarvestingGrowthState ~= nil and gs >= desc.minHarvestingGrowthState and gs <= (desc.maxHarvestingGrowthState or desc.minHarvestingGrowthState) then
                            ripe = ripe + 1
                        elseif gs ~= nil and desc.witheredState ~= nil and gs == desc.witheredState then
                            withered = withered + 1
                        end
                    end
                end
                -- Mitte der Reihe: was würde der Infokasten hier schreiben?
                if j == 2 and #fns > 0 then
                    local got, sick = {}, false
                    local me = silentSelf()
                    for _, fn in ipairs(fns) do
                        local before = #got
                        pcall(PlayerHUDUpdater[fn], me, st, silentBox(got))
                        for li = before + 1, #got do
                            local l = got[li]
                            count(lines, fn .. ":" .. string.sub(l[1], 1, 40) .. "=" .. string.sub(l[2], 1, 30))
                            if fungiLine(l[1], l[2]) then
                                sick = true
                            end
                        end
                    end
                    if #got > 0 then
                        hudRows = hudRows + 1
                    end
                    if sick then
                        sickHud = sickHud + 1
                    end
                end
            end
        end
    end
    if n == 0 then
        return nil
    end
    local res = { samples = n, rows = #rows, ripe = ripe * 100 / n, withered = withered * 100 / n,
        values = string.sub(dist(values, 60), 1, 3000), lines = string.sub(dist(lines, 30), 1, 2000), fruits = dist(fruits, 6), fns = table.concat(fns, " ") }
    if hudRows > 0 and sickHud > 0 then
        res.sick, res.sickFrom = sickHud * 100 / hudRows, "hud"
    elseif sickVal > 0 then
        res.sick, res.sickFrom = sickVal * 100 / n, "state." .. tostring(sickKey)
    elseif hudRows > 0 then
        res.sick, res.sickFrom = 0, "hud"
    end
    return res
end

-- Aufruf aus readOrchards (Server, alle 2 Minuten) mit { {p=Placeable, o=Eintrag}, … }
function FarmingHubLive:orchardProbe(list)
    if #list == 0 or g_currentMission == nil or not g_currentMission:getIsServer() then
        return
    end
    self.orchardRows = self.orchardRows or {}
    local budget = math.max(30, math.floor(FarmingHubLive.PROBE_MAX / #list))
    local results = {}
    for _, e in ipairs(list) do
        local uid = tostring(e.o.uid)
        local c = self.orchardRows[uid]
        if c == nil or g_time - c.t > FarmingHubLive.ROWS_MS then
            c = { t = g_time, rows = rowsOf(e.p) }
            self.orchardRows[uid] = c
        end
        local res = probe(e.o, c.rows, budget)
        if res ~= nil then
            -- Was die Plantage selbst liefert (Grundspiel: Wein, Oliven), hat Vorrang
            if (e.o.total or 0) <= 0 then
                e.o.total = res.samples
                e.o.ripe = res.ripe
                e.o.withered = res.withered
                e.o.how = "fieldState"
                if e.o.fruitIndex ~= nil then
                    e.o.fruit = e.o.fruit or U.fruitName(e.o.fruitIndex)
                    e.o.fruitTitle = e.o.fruitTitle or U.fruitTitle(e.o.fruitIndex)
                    pcall(function()
                        e.o.fill = e.o.fill or U.fillName(g_fruitTypeManager:getFillTypeIndexByFruitTypeIndex(e.o.fruitIndex))
                    end)
                end
            end
            if res.sick ~= nil and (e.o.sick == nil or res.sickFrom == "hud") then
                e.o.sick, e.o.sickFrom = res.sick, res.sickFrom
            end
            e.o.diag = e.o.diag or {}
            e.o.diag.field = string.format("rows=%d samples=%d fruits=%s", res.rows, res.samples, res.fruits)
            table.insert(results, { o = e.o, r = res })
        else
            e.o.diag = e.o.diag or {}
            e.o.diag.field = string.format("rows=%d samples=0", #c.rows)
        end
    end
    self:writeFieldInfo(results)
end

function FarmingHubLive:writeFieldInfo(results)
    local dir = self:dir()
    if dir == nil or XMLFile == nil then
        return
    end
    local xml = XMLFile.create("hubLinkFieldInfo", dir .. "/hubLinkFieldInfo.xml", "hubLinkFieldInfo")
    if xml == nil then
        return
    end
    local env = g_currentMission.environment
    xml:setString("hubLinkFieldInfo#day", tostring(env ~= nil and (env.currentMonotonicDay or env.currentDay) or ""))
    xml:setString("hubLinkFieldInfo#time", string.format("%02d:%02d", math.floor((env ~= nil and env.dayTime or 0) / 3600000) % 24, math.floor((env ~= nil and env.dayTime or 0) / 60000) % 60))
    xml:setString("hubLinkFieldInfo#fungiTexts", FarmingHubLive.fungiTexts())
    xml:setString("hubLinkFieldInfo#hudFunctions", table.concat(hudFunctions(), " "))
    for i, e in ipairs(results) do
        local k = string.format("hubLinkFieldInfo.orchard(%d)", i - 1)
        xml:setString(k .. "#uid", tostring(e.o.uid))
        xml:setString(k .. "#name", tostring(e.o.name or ""))
        xml:setString(k .. "#farm", tostring(e.o.farm or 0))
        xml:setString(k .. "#rows", tostring(e.r.rows))
        xml:setString(k .. "#samples", tostring(e.r.samples))
        xml:setString(k .. "#fruits", e.r.fruits)
        xml:setString(k .. "#ripe", U.num(e.r.ripe, 0))
        xml:setString(k .. "#withered", U.num(e.r.withered, 0))
        if e.r.sick ~= nil then
            xml:setString(k .. "#sick", U.num(e.r.sick, 0))
            xml:setString(k .. "#sickFrom", e.r.sickFrom)
        end
        xml:setString(k .. ".values", e.r.values)
        xml:setString(k .. ".hudLines", e.r.lines)
    end
    xml:save()
    xml:delete()
end

-- Wo das Spiel sonst noch Plantagen führen könnte: Schlüssel von g_currentMission und globale Namen (einmal je Laden)
local MISSION_WORDS = { "orchard", "banana", "coffee", "plant", "tree", "disease", "fung", "pdlc", "beans" }
function FarmingHubLive.missionKeys()
    if FarmingHubLive.missionKeyText ~= nil then
        return FarmingHubLive.missionKeyText
    end
    local out = {}
    pcall(function()
        for k, v in pairs(g_currentMission or {}) do
            if type(k) == "string" and hasWord(k, MISSION_WORDS) then
                table.insert(out, "m." .. k .. ":" .. string.sub(type(v), 1, 1))
            end
        end
        for k, v in pairs(_G) do
            if type(k) == "string" and hasWord(k, MISSION_WORDS) then
                table.insert(out, "g." .. k .. ":" .. string.sub(type(v), 1, 1))
            end
        end
    end)
    table.sort(out)
    FarmingHubLive.missionKeyText = string.sub(table.concat(out, " "), 1, 3000)
    return FarmingHubLive.missionKeyText
end

-- ---------- Echter Infokasten beim Spieler (jeder Rechner, auch ohne Server) ----------
-- Jede field…-Funktion bekommt eine Hülle: erst das Original, dabei mitschreiben, welche Zeilen es in den Kasten setzt.
-- Nichts am Kasten ändert sich; Fehler der Hülle bleiben in pcall.
HubLinkHudLines = { seen = {}, order = {}, dirty = false, t = 0, wrapped = {} }
-- Lua 5.1 im Spiel: kein table.pack
local function pack(...)
    return { n = select("#", ...), ... }
end
local unpackAll = unpack or table.unpack

local function wrapField(name)
    local orig = PlayerHUDUpdater[name]
    if type(orig) ~= "function" or HubLinkHudLines.wrapped[name] then
        return
    end
    HubLinkHudLines.wrapped[name] = true
    PlayerHUDUpdater[name] = function(self, data, box, ...)
        local got, put = nil, nil
        if type(box) == "table" and rawget(box, "addLine") == nil and type(box.addLine) == "function" then
            local real = box.addLine
            got = {}
            put = function(b, label, value, ...)
                table.insert(got, { tostring(label or ""), tostring(value or "") })
                return real(b, label, value, ...)
            end
            rawset(box, "addLine", put)
        end
        local r = pack(pcall(orig, self, data, box, ...))
        if put ~= nil and rawget(box, "addLine") == put then
            rawset(box, "addLine", nil)
        end
        if got ~= nil and #got > 0 then
            pcall(HubLinkHudLines.note, name, data, got)
        end
        if not r[1] then
            error(r[2], 0)
        end
        return unpackAll(r, 2, r.n)
    end
end

function HubLinkHudLines.install()
    if PlayerHUDUpdater == nil then
        return
    end
    for _, name in ipairs(hudFunctions()) do
        wrapField(name)
    end
end

function HubLinkHudLines.note(fn, data, got)
    local self = HubLinkHudLines
    local fungi = false
    for _, l in ipairs(got) do
        if fungiLine(l[1], l[2]) or string.find(string.lower(l[1] .. l[2]), "fungi", 1, true) then
            fungi = true
        end
        local key = fn .. ":" .. string.sub(l[1], 1, 40)
        local e = self.seen[key]
        if e == nil then
            if #self.order >= FarmingHubLive.HUD_MAX * 3 then
                return
            end
            e = { key = key, fn = fn, label = l[1], n = 0 }
            self.seen[key] = e
            table.insert(self.order, e)
            self.dirty = true
        end
        e.n = e.n + 1
        e.value = l[2]
    end
    -- Bei einer Fungizid-Zeile alle Werte des Feldzustands festhalten (das ist die gesuchte Stelle)
    if fungi then
        local sc = scalars(data)
        local parts = {}
        for k, v in pairs(sc) do
            table.insert(parts, k .. "=" .. (type(v) == "number" and U.num(v, 3) or tostring(v)))
        end
        table.sort(parts)
        local x, z = nil, nil
        pcall(function()
            if g_localPlayer ~= nil and g_localPlayer.getPosition ~= nil then
                local px, _, pz = g_localPlayer:getPosition()
                x, z = px, pz
            end
        end)
        local lines = {}
        for _, l in ipairs(got) do
            table.insert(lines, l[1] .. "=" .. l[2])
        end
        self.fungi = self.fungi or {}
        if #self.fungi >= FarmingHubLive.HUD_MAX then
            table.remove(self.fungi, 1)
        end
        table.insert(self.fungi, { fn = fn, x = x, z = z, state = table.concat(parts, " "), lines = table.concat(lines, " | ") })
        self.dirty = true
    end
end

function HubLinkHudLines:loadMap()
    HubLinkHudLines.install()
end

function HubLinkHudLines:update(dt)
    self.t = self.t + dt
    if not self.dirty or self.t < FarmingHubLive.HUD_WRITE_MS then
        return
    end
    self.t = 0
    self.dirty = false
    pcall(function()
        local base = getUserProfileAppPath() .. "modSettings"
        createFolder(base)
        base = base .. "/" .. FarmingHubLive.MOD_DIR
        createFolder(base)
        local xml = XMLFile.create("hubLinkHudLines", base .. "/" .. FarmingHubLive.HUD_FILE, "hubLinkHudLines")
        if xml == nil then
            return
        end
        xml:setString("hubLinkHudLines#mod", tostring(FarmingHubLive.modVersion or ""))
        xml:setString("hubLinkHudLines#fungiTexts", FarmingHubLive.fungiTexts())
        for i, e in ipairs(self.order) do
            local k = string.format("hubLinkHudLines.line(%d)", i - 1)
            xml:setString(k .. "#fn", e.fn)
            xml:setString(k .. "#label", e.label)
            xml:setString(k .. "#lastValue", tostring(e.value or ""))
            xml:setInt(k .. "#count", e.n)
        end
        for i, f in ipairs(self.fungi or {}) do
            local k = string.format("hubLinkHudLines.fungi(%d)", i - 1)
            xml:setString(k .. "#fn", f.fn)
            xml:setString(k .. "#pos", string.format("%s %s", U.num(f.x or 0, 1), U.num(f.z or 0, 1)))
            xml:setString(k .. ".lines", f.lines)
            xml:setString(k .. ".state", f.state)
        end
        xml:save()
        xml:delete()
    end)
end

function HubLinkHudLines:deleteMap()
end

-- Grundspiel-Funktionen gleich beim Laden umhüllen, DLC-Funktionen spätestens beim Laden der Karte
pcall(HubLinkHudLines.install)
addModEventListener(HubLinkHudLines)
