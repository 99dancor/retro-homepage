-- FS25 Hub Link: Abbild der Plantagen (ab Mod 3.10)
--
-- Die Plantagen des DLC (Bananen, Kaffee) zeigen Bäume, Wachstum und Krankheit nicht an ihrer Spezialisierung. Was das
-- Spiel beim Speichern über eine Plantage schreibt, kommt aber vollständig aus ihrem saveToXMLFile. Die Mod ruft das
-- auf dem Server alle 2 Minuten selbst auf und schreibt es in eigene Dateien, ohne den Spielstand zu speichern:
--
--   hubLinkOrchards.xml             neuester Stand aller Plantagen (alle 2 Minuten)
--   hubLinkOrchards_tag<N>.xml      einmal je Spieltag, die letzten DIAG_DAYS Tage (N = Tag mod DIAG_DAYS)
--   hubLinkOrchards_wechsel<N>.xml  jedes Mal, wenn sich ein Wert ändert, der nach Krankheit, Pilz, Spritzen oder
--                                   Wachstumsstufe klingt (die letzten DIAG_CHANGES Wechsel)
--   hubLinkOrchardLog.xml           Verlauf dieser Wechsel mit Spieltag und Uhrzeit (die letzten DIAG_LOG_MAX)
--
-- Alles liegt in modSettings/FS25_FarmingHubExport/<Spielstand>/. So geht der Moment, an dem Fungizid nötig wird,
-- nicht verloren, auch wenn niemand rechtzeitig speichert. Findet die Mod im Abbild einen Krankheitswert, zählt er
-- auch gleich für die Plantagen-Prüfung (sickFrom = "save:…").

local U = FarmingHubLive.U

FarmingHubLive.DIAG_DAYS = 10
FarmingHubLive.DIAG_CHANGES = 10
FarmingHubLive.DIAG_LOG_MAX = 60
FarmingHubLive.DIAG_SIG_MAX = 3000

-- Wörter, bei denen ein Wert in den Verlauf kommt; SICK_WORDS zählen außerdem als Krankheit
local LOG_WORDS = { "disease", "fung", "infect", "sick", "spray", "pest", "health", "blight", "mold", "mould", "treat", "protect", "state", "stage", "growth", "wither" }
local SICK_WORDS = { "disease", "fung", "infect", "sick", "blight", "pest", "mold", "mould" }

local function hasWord(name, words)
    local l = string.lower(name)
    for _, w in ipairs(words) do
        if string.find(l, w, 1, true) then
            return true
        end
    end
    return false
end

-- Werte im Text des Abbilds: je tag#attr die Verteilung der Werte, z. B. tree#disease 0×120 1×4
function FarmingHubLive.orchardSignature(text)
    local seen, order = {}, {}
    for tag, attrs in string.gmatch(text or "", "<([%w_%.]+)([^>]*)>") do
        for a, v in string.gmatch(attrs, "([%w_%.]+)=\"([^\"]*)\"") do
            if hasWord(a, LOG_WORDS) or hasWord(tag, SICK_WORDS) then
                local k = tag .. "#" .. a
                local e = seen[k]
                if e == nil then
                    e = { key = k, sick = hasWord(a, SICK_WORDS) or hasWord(tag, SICK_WORDS), n = 0, vals = {}, nv = 0 }
                    seen[k] = e
                    table.insert(order, e)
                end
                e.n = e.n + 1
                if e.vals[v] == nil then
                    e.nv = e.nv + 1
                    e.vals[v] = 0
                end
                e.vals[v] = e.vals[v] + 1
            end
        end
    end
    table.sort(order, function(a, b)
        return a.key < b.key
    end)
    local parts = {}
    for _, e in ipairs(order) do
        local vs = {}
        for v, c in pairs(e.vals) do
            table.insert(vs, { v, c })
        end
        table.sort(vs, function(a, b)
            return a[1] < b[1]
        end)
        local s = {}
        for i, x in ipairs(vs) do
            if i <= 8 then
                table.insert(s, string.format("%s×%d", string.sub(x[1], 1, 20), x[2]))
            end
        end
        if #vs > 8 then
            table.insert(s, string.format("+%d", #vs - 8))
        end
        table.insert(parts, e.key .. " " .. table.concat(s, " "))
    end
    return table.concat(parts, "; "), order
end

-- Anteil krank aus dem Abbild: Einträge mit einem Krankheitswert über 0 (oder true) an allen Einträgen mit diesem Wert
function FarmingHubLive.sickFromSignature(order)
    for _, e in ipairs(order or {}) do
        -- nur Werte, die je Baum oder Reihe vorkommen (mindestens 2), keine einzelnen Schalter wie „diseaseEnabled“
        if e.sick and e.n >= 2 then
            local bad, nums = 0, true
            for v, c in pairs(e.vals) do
                local n = tonumber(v)
                if v == "true" then
                    bad = bad + c
                elseif n == nil then
                    nums = false
                elseif n > 0 then
                    bad = bad + c
                end
            end
            if nums then
                return bad * 100 / e.n, "save:" .. e.key
            end
        end
    end
    return nil, nil
end

local function clockOf()
    local env = g_currentMission ~= nil and g_currentMission.environment or nil
    if env == nil then
        return 0, 0
    end
    return env.currentMonotonicDay or env.currentDay or 0, math.floor((env.dayTime or 0) / 60000)
end

-- Alle Plantagen in eine Datei; gibt den Text zurück, wenn das Spiel ihn liefern kann
local function dumpTo(path, list)
    if XMLFile == nil or XMLFile.create == nil then
        return nil
    end
    local schema = Placeable ~= nil and Placeable.xmlSchemaSavegame or nil
    local xml = XMLFile.create("hubLinkOrchards", path, "placeables", schema)
    if xml == nil then
        return nil
    end
    local day, minute = clockOf()
    xml:setString("placeables#hubLinkDay", tostring(day))
    xml:setString("placeables#hubLinkTime", string.format("%02d:%02d", math.floor(minute / 60) % 24, minute % 60))
    for i, e in ipairs(list) do
        local key = string.format("placeables.placeable(%d)", i - 1)
        local ok, err = pcall(function()
            e.p:saveToXMLFile(xml, key, {})
        end)
        xml:setString(key .. "#hubLinkUid", tostring(e.o.uid or ""))
        xml:setString(key .. "#hubLinkName", tostring(e.o.name or ""))
        if not ok then
            xml:setString(key .. "#hubLinkError", string.sub(tostring(err), 1, 300))
        end
    end
    local text = nil
    if saveXMLFileToMemory ~= nil and xml.handle ~= nil then
        local ok, t = pcall(saveXMLFileToMemory, xml.handle)
        if ok and type(t) == "string" then
            text = t
        end
    end
    xml:save()
    xml:delete()
    return text
end

-- Verlauf: neuer Eintrag vorn, alte Einträge dahinter, höchstens DIAG_LOG_MAX
local function appendLog(path, entry)
    local old = {}
    if fileExists(path) then
        local xml = XMLFile.load("hubLinkOrchardLog", path)
        if xml ~= nil then
            xml:iterate("hubLinkOrchardLog.change", function(_, k)
                if #old < FarmingHubLive.DIAG_LOG_MAX - 1 then
                    table.insert(old, { day = xml:getString(k .. "#day"), time = xml:getString(k .. "#time"), uid = xml:getString(k .. "#uid"),
                        name = xml:getString(k .. "#name"), sick = xml:getString(k .. "#sick"), file = xml:getString(k .. "#file"), values = xml:getString(k .. "#values") })
                end
            end)
            xml:delete()
        end
    end
    table.insert(old, 1, entry)
    local xml = XMLFile.create("hubLinkOrchardLog", path, "hubLinkOrchardLog")
    if xml == nil then
        return
    end
    for i, e in ipairs(old) do
        local k = string.format("hubLinkOrchardLog.change(%d)", i - 1)
        for _, a in ipairs({ "day", "time", "uid", "name", "sick", "file", "values" }) do
            if e[a] ~= nil then
                xml:setString(k .. "#" .. a, tostring(e[a]))
            end
        end
    end
    xml:save()
    xml:delete()
end

-- Aufruf aus readOrchards mit { {p=Placeable, o=Eintrag}, … }
function FarmingHubLive:orchardSnapshot(list)
    if #list == 0 or g_currentMission == nil or not g_currentMission:getIsServer() then
        return
    end
    local dir = self:dir()
    if dir == nil then
        return
    end
    local text = dumpTo(dir .. "/hubLinkOrchards.xml", list)
    local day, minute = clockOf()
    -- einmal je Spieltag eine Kopie, die DIAG_DAYS Tage hält
    if self.diagDay ~= day then
        self.diagDay = day
        dumpTo(string.format("%s/hubLinkOrchards_tag%d.xml", dir, day % FarmingHubLive.DIAG_DAYS), list)
    end
    if text == nil then
        return
    end
    -- je Plantage ihr Teil des Texts (in der Reihenfolge der Liste)
    local pieces = {}
    for piece in string.gmatch(text, "<placeable[%s>].-</placeable>") do
        table.insert(pieces, piece)
    end
    self.diagSig = self.diagSig or {}
    local changed = false
    for i, e in ipairs(list) do
        local sig, order = FarmingHubLive.orchardSignature(pieces[i] or "")
        if e.o.sick == nil then
            e.o.sick, e.o.sickFrom = FarmingHubLive.sickFromSignature(order)
        end
        e.o.diag = e.o.diag or {}
        e.o.diag.save = string.sub(sig, 1, 1500)
        local uid = tostring(e.o.uid)
        if self.diagSig[uid] ~= sig then
            -- der erste Stand nach dem Laden ist kein Wechsel, kommt aber einmal in den Verlauf
            local first = self.diagSig[uid] == nil
            self.diagSig[uid] = sig
            self.diagN = ((self.diagN or -1) + 1) % FarmingHubLive.DIAG_CHANGES
            local file = first and "" or string.format("hubLinkOrchards_wechsel%d.xml", self.diagN)
            changed = changed or not first
            appendLog(dir .. "/hubLinkOrchardLog.xml", {
                day = day, time = string.format("%02d:%02d", math.floor(minute / 60) % 24, minute % 60), uid = uid, name = e.o.name,
                sick = e.o.sick ~= nil and U.num(e.o.sick, 1) or nil, file = file ~= "" and file or nil,
                values = (first and "Start: " or "") .. string.sub(sig, 1, FarmingHubLive.DIAG_SIG_MAX),
            })
            if not first then
                dumpTo(dir .. "/" .. file, list)
            end
        end
    end
    return changed
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
