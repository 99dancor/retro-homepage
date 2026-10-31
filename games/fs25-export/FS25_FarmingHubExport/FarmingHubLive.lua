-- Farming Hub Live (ab Mod 3.0)
--
-- Zwei Aufgaben, beide nur auf dem Server bzw. im Einzelspieler:
--
--   Produktionsberater  prüft alle 10 Sekunden die Gebäude jedes Hofs, wie die Mod „Production Advisor“: Eingänge, die leer
--                       laufen (Reichweite in Spielstunden aus Rezept und Zyklen), Produktionen, denen eine Zutat fehlt, volle
--                       Ausgänge, blockierte Paletten-Ausgänge, Ställe (Futter, Wasser, Stroh knapp; Milch, Gülle, Mist voll;
--                       kein Platz für Paletten) und volle Silos. Jedes Problem wird genau eine Aufgabe mit festem Schlüssel.
--                       Ist es behoben, verschwindet sie wieder. Damit nichts flackert, schließt sie erst mit Abstand zur
--                       Schwelle (z. B. voll ab 85 %, wieder frei unter 75 %).
--   Austausch mit dem   Das Spiel kann keine Website aufrufen. Deshalb schreibt die Mod alle 30 Sekunden (wenn sich etwas
--   Hub                 geändert hat, sonst alle 2 Minuten als Lebenszeichen) farmingHubLive.xml und liest
--                       farmingHubInbox.xml, die der Hub per FTP hochlädt. Beide liegen in
--                       modSettings/FS25_FarmingHubExport/<Spielstand-Ordner>/, nicht im Spielstand-Ordner selbst, den das
--                       Spiel beim Speichern neu schreibt.
--
-- Einstellungen (farmingHubSettings.xml im selben Ordner): Export an/aus, Produktionsberater an/aus und je Hof die Prüfungen
-- und Schwellen. Der Hub ändert sie über die Inbox, im Spiel über die Konsole (hubStatus, hubSet). Jede Änderung zählt die
-- Nummer rev hoch, die höhere Nummer gewinnt. Aufgaben aus dem Hub, die selbst vom Spiel kamen, schickt der Hub nicht zurück.

FarmingHubLive = {}
FarmingHubLive.VERSION = 1
FarmingHubLive.MOD_DIR = "FS25_FarmingHubExport"
FarmingHubLive.LIVE = "farmingHubLive.xml"
FarmingHubLive.INBOX = "farmingHubInbox.xml"
FarmingHubLive.SETTINGS = "farmingHubSettings.xml"
FarmingHubLive.CHECK_MS = 10000
FarmingHubLive.WRITE_MS = 30000
FarmingHubLive.BEAT_MS = 120000
FarmingHubLive.READ_MS = 30000
FarmingHubLive.BLOCKED_MS = 600000

-- Vorgaben je Hof. Reihenfolge = Reihenfolge in den Dateien
FarmingHubLive.FARM_KEYS = {
    { "input", true }, { "inputHours", 6 }, { "inputPct", 10 },
    { "output", true }, { "outputPct", 85 },
    { "pallets", true },
    { "stall", true }, { "stallPct", 15 }, { "stallFullPct", 85 },
    { "silo", true }, { "siloPct", 90 },
}

FarmingHubLive.settings = { rev = 0, export = true, advisor = true, farms = {} }
FarmingHubLive.problems = {}
FarmingHubLive.blocked = {}
FarmingHubLive.hubTasks = {}
FarmingHubLive.hubNotes = {}
FarmingHubLive.dismissed = {}
FarmingHubLive.inboxSeq = 0
FarmingHubLive.seq = 0
FarmingHubLive.lastSig = nil
FarmingHubLive.timers = { check = 0, write = 0, beat = 0, read = 0 }

local function log(fmt, ...)
    print(string.format("FarmingHubLive: " .. fmt, ...))
end

local function try(what, fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then
        Logging.warning("FarmingHubLive: %s: %s", what, tostring(err))
    end
    return ok
end

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

local function fillName(index)
    if index == nil or g_fillTypeManager == nil then
        return nil
    end
    local name = g_fillTypeManager:getFillTypeNameByIndex(index)
    if name == "UNKNOWN" then
        return nil
    end
    return name
end

local function fillTitle(index)
    if index == nil or g_fillTypeManager == nil or g_fillTypeManager.getFillTypeTitleByIndex == nil then
        return nil
    end
    return g_fillTypeManager:getFillTypeTitleByIndex(index)
end

local function bool(v)
    return v == true or v == "true" or v == "on" or v == "an" or v == "1" or v == 1
end

local function num(v, digits)
    return string.format("%." .. (digits or 1) .. "f", v or 0)
end

-- ---------- Einstellungen ----------
function FarmingHubLive:farm(id)
    local own = self.settings.farms[id] or {}
    local out = {}
    for _, kv in ipairs(FarmingHubLive.FARM_KEYS) do
        local v = own[kv[1]]
        if v == nil then
            v = kv[2]
        end
        out[kv[1]] = v
    end
    return out
end

function FarmingHubLive.readSettings(xml, key)
    local s = { rev = xml:getInt(key .. "#rev") or 0, export = xml:getBool(key .. "#export"), advisor = xml:getBool(key .. "#advisor"), farms = {} }
    if s.export == nil then
        s.export = true
    end
    if s.advisor == nil then
        s.advisor = true
    end
    local i = 0
    while true do
        local k = string.format("%s.farm(%d)", key, i)
        if not xml:hasProperty(k) then
            break
        end
        local id = xml:getInt(k .. "#id")
        if id ~= nil then
            local f = {}
            for _, kv in ipairs(FarmingHubLive.FARM_KEYS) do
                if type(kv[2]) == "boolean" then
                    f[kv[1]] = xml:getBool(k .. "#" .. kv[1])
                else
                    f[kv[1]] = xml:getFloat(k .. "#" .. kv[1])
                end
            end
            s.farms[id] = f
        end
        i = i + 1
    end
    return s
end

function FarmingHubLive.writeSettings(xml, key, s)
    xml:setInt(key .. "#rev", s.rev or 0)
    xml:setBool(key .. "#export", s.export ~= false)
    xml:setBool(key .. "#advisor", s.advisor ~= false)
    local ids = {}
    for id in pairs(s.farms or {}) do
        table.insert(ids, id)
    end
    table.sort(ids)
    for i, id in ipairs(ids) do
        local k = string.format("%s.farm(%d)", key, i - 1)
        xml:setInt(k .. "#id", id)
        for _, kv in ipairs(FarmingHubLive.FARM_KEYS) do
            local v = s.farms[id][kv[1]]
            if v ~= nil then
                if type(kv[2]) == "boolean" then
                    xml:setBool(k .. "#" .. kv[1], v == true)
                else
                    xml:setString(k .. "#" .. kv[1], num(v, 1))
                end
            end
        end
    end
end

-- Ordner für den Austausch: modSettings/FS25_FarmingHubExport/<savegameN>
function FarmingHubLive:dir()
    if self.exchangeDir ~= nil then
        return self.exchangeDir
    end
    local info = g_currentMission ~= nil and g_currentMission.missionInfo or nil
    if info == nil then
        return nil
    end
    local name = nil
    if info.savegameDirectory ~= nil and info.savegameDirectory ~= "" then
        name = string.match(info.savegameDirectory, "([^/\\]+)[/\\]*$")
    end
    if name == nil and info.savegameIndex ~= nil then
        name = "savegame" .. tostring(info.savegameIndex)
    end
    if name == nil then
        return nil
    end
    local base = getUserProfileAppPath() .. "modSettings"
    createFolder(base)
    base = base .. "/" .. FarmingHubLive.MOD_DIR
    createFolder(base)
    base = base .. "/" .. name
    createFolder(base)
    self.exchangeDir = base
    self.saveName = name
    return base
end

function FarmingHubLive:loadSettings()
    local dir = self:dir()
    if dir == nil then
        return
    end
    local file = dir .. "/" .. FarmingHubLive.SETTINGS
    if not fileExists(file) then
        return
    end
    local xml = XMLFile.load("farmingHubSettings", file)
    if xml == nil then
        return
    end
    self.settings = FarmingHubLive.readSettings(xml, "farmingHubSettings")
    xml:delete()
end

function FarmingHubLive:saveSettings()
    local dir = self:dir()
    if dir == nil then
        return
    end
    local xml = XMLFile.create("farmingHubSettings", dir .. "/" .. FarmingHubLive.SETTINGS, "farmingHubSettings")
    if xml == nil then
        return
    end
    FarmingHubLive.writeSettings(xml, "farmingHubSettings", self.settings)
    xml:save()
    xml:delete()
end

function FarmingHubLive:exportEnabled()
    return self.settings.export ~= false
end

-- ---------- Produktionsberater ----------
local function uidOf(p)
    return (p.getUniqueId ~= nil and p:getUniqueId()) or p.uniqueId or tostring(p.id or "")
end

-- Ergebnis eines Paletten-Ausgangs merken: „kein Platz“ heißt blockiert, bis eine Palette wieder klappt
function FarmingHubLive:onPalletResult(target, result, fillType)
    if target == nil or PalletSpawner == nil then
        return
    end
    if result == PalletSpawner.RESULT_NO_SPACE then
        self.blocked[target] = { fill = fillType, t = g_time }
    elseif result == PalletSpawner.RESULT_SUCCESS then
        self.blocked[target] = nil
    end
end

function FarmingHubLive:isBlocked(...)
    for _, target in ipairs({ ... }) do
        local b = target ~= nil and self.blocked[target] or nil
        if b ~= nil then
            if g_time - b.t < FarmingHubLive.BLOCKED_MS then
                return b
            end
            self.blocked[target] = nil
        end
    end
    return nil
end

-- Ein Problem eintragen; „open“ sagt, ob es beim letzten Durchgang schon offen war (für den Abstand zur Schwelle)
function FarmingHubLive:add(found, p)
    p.key = string.format("%s:%d:%s:%s", p.kind, p.farm, p.uid, p.part or p.fill or "")
    found[p.key] = p
end

function FarmingHubLive:wasOpen(kind, farm, uid, part)
    return self.problems[string.format("%s:%d:%s:%s", kind, farm, uid, part or "")] ~= nil
end

local function cyclesPerHour(prod)
    if type(prod.cyclesPerHour) == "number" then
        return prod.cyclesPerHour
    elseif type(prod.cyclesPerMinute) == "number" then
        return prod.cyclesPerMinute * 60
    elseif type(prod.cyclesPerMonth) == "number" then
        return prod.cyclesPerMonth / 24
    end
    return nil
end

function FarmingHubLive:checkProduction(found, cfg, base, point)
    local storage = point.storage
    if storage == nil then
        return
    end
    local status = ProductionPoint ~= nil and ProductionPoint.PROD_STATUS or {}
    local active = point.activeProductions or {}
    local shared = point.sharedThroughputCapacity ~= false and #active > 1
    local need, outs, stopped = {}, {}, {}
    for _, prod in ipairs(active) do
        local cph = cyclesPerHour(prod)
        if cph ~= nil and shared then
            cph = cph / #active
        end
        for _, i in ipairs(prod.inputs or {}) do
            local ft = i.type or i.fillTypeIndex
            if ft ~= nil then
                need[ft] = (need[ft] or 0) + (cph ~= nil and (i.amount or 0) * cph or 0)
                -- Zutat fehlt: die Produktion steht
                if cfg.input and status.MISSING_INPUTS ~= nil and prod.status == status.MISSING_INPUTS and (call(storage, { "getFillLevel" }, ft) or 0) < (i.amount or 0) then
                    stopped[ft] = true
                    self:add(found, { kind = "stopped", farm = base.farm, uid = base.uid, name = base.name, fill = fillName(ft), fillTitle = fillTitle(ft), sev = 3,
                        level = call(storage, { "getFillLevel" }, ft) or 0, cap = call(storage, { "getCapacity" }, ft), part = tostring(prod.id or "") .. "/" .. tostring(fillName(ft)) })
                end
            end
        end
        for _, o in ipairs(prod.outputs or {}) do
            local ft = o.type or o.fillTypeIndex
            if ft ~= nil and not o.sellDirectly then
                outs[ft] = true
            end
        end
    end
    if cfg.input then
        for ft, perHour in pairs(need) do
            local name = fillName(ft)
            if name ~= nil and not stopped[ft] then
                local level = call(storage, { "getFillLevel" }, ft) or 0
                local cap = call(storage, { "getCapacity" }, ft) or 0
                local pct = cap > 0 and level / cap * 100 or nil
                local hours = perHour > 0 and level / perHour or nil
                local open = self:wasOpen("input", base.farm, base.uid, name)
                local low
                if hours ~= nil then
                    low = hours < cfg.inputHours * (open and 1.5 or 1)
                elseif pct ~= nil then
                    low = pct < cfg.inputPct + (open and 10 or 0)
                end
                if low then
                    self:add(found, { kind = "input", farm = base.farm, uid = base.uid, name = base.name, fill = name, fillTitle = fillTitle(ft), sev = (hours ~= nil and hours < 1) and 3 or 2,
                        level = level, cap = cap, pct = pct, hours = hours })
                end
            end
        end
    end
    if cfg.output then
        local direct = point.outputFillTypeIdsDirectSell or {}
        for ft in pairs(outs) do
            local name = fillName(ft)
            if name ~= nil and not direct[ft] then
                local cap = call(storage, { "getCapacity" }, ft) or 0
                local free = call(storage, { "getFreeCapacity" }, ft)
                local level = call(storage, { "getFillLevel" }, ft) or 0
                local used = free ~= nil and (cap - free) or level
                local pct = cap > 0 and used / cap * 100 or nil
                local open = self:wasOpen("output", base.farm, base.uid, name)
                if pct ~= nil and pct >= cfg.outputPct - (open and 10 or 0) then
                    self:add(found, { kind = "output", farm = base.farm, uid = base.uid, name = base.name, fill = name, fillTitle = fillTitle(ft), sev = pct >= 99 and 3 or 2,
                        level = level, cap = cap, pct = pct })
                end
            end
        end
    end
    if cfg.pallets then
        local b = self:isBlocked(point, base.placeable)
        if b ~= nil then
            self:add(found, { kind = "blocked", farm = base.farm, uid = base.uid, name = base.name, fill = fillName(b.fill), fillTitle = fillTitle(b.fill), sev = 3, part = "pallets" })
        end
    end
end

function FarmingHubLive:checkStall(found, cfg, base, p)
    if not cfg.stall then
        return
    end
    local animals = call(p, { "getNumOfAnimals" })
    if type(animals) == "number" and animals <= 0 then
        return
    end
    local foods = call(p, { "getFoodInfos" }) or {}
    local total, cap = 0, 0
    for _, info in ipairs(foods) do
        total = total + (type(info.value) == "number" and info.value or 0)
        if type(info.capacity) == "number" and info.capacity > cap then
            cap = info.capacity
        end
    end
    if cap > 0 then
        local pct = total / cap * 100
        local open = self:wasOpen("food", base.farm, base.uid, "food")
        if pct < cfg.stallPct + (open and 10 or 0) then
            self:add(found, { kind = "food", farm = base.farm, uid = base.uid, name = base.name, part = "food", sev = pct < 1 and 3 or 2, level = total, cap = cap, pct = pct })
        end
    end
    for _, info in ipairs(call(p, { "getConditionInfos" }) or {}) do
        local ratio = info.ratio
        if type(ratio) == "number" and type(info.capacity) == "number" and info.capacity > 0 then
            local pct = ratio * 100
            local title = tostring(info.title or "")
            if info.invertedBar then
                local open = self:wasOpen("product", base.farm, base.uid, title)
                if pct >= cfg.stallFullPct - (open and 10 or 0) then
                    self:add(found, { kind = "product", farm = base.farm, uid = base.uid, name = base.name, part = title, fillTitle = title, sev = pct >= 99 and 3 or 2,
                        level = info.value, cap = info.capacity, pct = pct })
                end
            else
                local open = self:wasOpen("supply", base.farm, base.uid, title)
                if pct < cfg.stallPct + (open and 10 or 0) then
                    self:add(found, { kind = "supply", farm = base.farm, uid = base.uid, name = base.name, part = title, fillTitle = title, sev = pct < 1 and 3 or 2,
                        level = info.value, cap = info.capacity, pct = pct })
                end
            end
        end
    end
    if cfg.pallets then
        local spec = p.spec_husbandryPallets
        if (spec ~= nil and spec.palletLimitReached) or self:isBlocked(p) ~= nil then
            self:add(found, { kind = "pallets", farm = base.farm, uid = base.uid, name = base.name, part = "pallets", sev = 3 })
        end
    end
end

function FarmingHubLive:checkSilo(found, cfg, base, p)
    if not cfg.silo then
        return
    end
    for i, s in ipairs((p.spec_silo or {}).storages or {}) do
        local levels = s.fillLevels or {}
        local perFill = s.capacities ~= nil and next(s.capacities) ~= nil
        if perFill then
            for ft, level in pairs(levels) do
                local cap = s.capacities[ft] or s.capacity or 0
                local name = fillName(ft)
                if name ~= nil and cap > 0 then
                    local pct = level / cap * 100
                    local open = self:wasOpen("silo", base.farm, base.uid, name)
                    if pct >= cfg.siloPct - (open and 10 or 0) then
                        self:add(found, { kind = "silo", farm = base.farm, uid = base.uid, name = base.name, fill = name, fillTitle = fillTitle(ft), sev = pct >= 99 and 3 or 2, level = level, cap = cap, pct = pct })
                    end
                end
            end
        else
            local total, top, topLevel = 0, nil, -1
            for ft, level in pairs(levels) do
                total = total + level
                if level > topLevel then
                    top, topLevel = ft, level
                end
            end
            local cap = s.capacity or 0
            if cap > 0 then
                local pct = total / cap * 100
                local part = "storage" .. tostring(i)
                local open = self:wasOpen("silo", base.farm, base.uid, part)
                if pct >= cfg.siloPct - (open and 10 or 0) then
                    self:add(found, { kind = "silo", farm = base.farm, uid = base.uid, name = base.name, part = part, fill = fillName(top), fillTitle = fillTitle(top), sev = pct >= 99 and 3 or 2,
                        level = total, cap = cap, pct = pct })
                end
            end
        end
    end
end

function FarmingHubLive:checkPlaceable(found, p)
    local farm = (p.getOwnerFarmId ~= nil and p:getOwnerFarmId()) or 0
    if farm == nil or farm < 1 or (FarmManager ~= nil and FarmManager.SPECTATOR_FARM_ID ~= nil and farm == FarmManager.SPECTATOR_FARM_ID) then
        return
    end
    local cfg = self:farm(farm)
    local base = { farm = farm, uid = uidOf(p), name = (p.getName ~= nil and tostring(p:getName() or "")) or "", placeable = p }
    local point = p.spec_productionPoint ~= nil and p.spec_productionPoint.productionPoint or nil
    if point ~= nil then
        try("Produktion", self.checkProduction, self, found, cfg, base, point)
    end
    if p.spec_husbandryAnimals ~= nil then
        try("Stall", self.checkStall, self, found, cfg, base, p)
    end
    if p.spec_silo ~= nil and point == nil and p.spec_husbandryAnimals == nil then
        try("Silo", self.checkSilo, self, found, cfg, base, p)
    end
end

function FarmingHubLive:check()
    local found = {}
    if self.settings.advisor ~= false then
        local list = (g_currentMission.placeableSystem ~= nil and g_currentMission.placeableSystem.placeables) or {}
        for _, p in ipairs(list) do
            self:checkPlaceable(found, p)
        end
    end
    self.problems = found
end

-- ---------- Dateien ----------
local function sortedKeys(t)
    local keys = {}
    for k in pairs(t) do
        table.insert(keys, k)
    end
    table.sort(keys)
    return keys
end

-- Fingerabdruck: ändert sich, wenn eine Aufgabe dazukommt, wegfällt oder sich um mindestens 1 % bzw. 1 Stunde bewegt
function FarmingHubLive:signature()
    local parts = { tostring(self.settings.rev), tostring(self.inboxSeq) }
    for _, key in ipairs(sortedKeys(self.problems)) do
        local p = self.problems[key]
        table.insert(parts, string.format("%s|%d|%d", key, math.floor(p.pct or -1), math.floor(p.hours or -1)))
    end
    return table.concat(parts, ";")
end

function FarmingHubLive:writeLive()
    local dir = self:dir()
    if dir == nil then
        return false
    end
    local xml = XMLFile.create("farmingHubLive", dir .. "/" .. FarmingHubLive.LIVE, "farmingHubLive")
    if xml == nil then
        return false
    end
    self.seq = self.seq + 1
    local r = "farmingHubLive"
    local mission = g_currentMission
    local info = mission.missionInfo or {}
    xml:setInt(r .. "#version", FarmingHubLive.VERSION)
    xml:setString(r .. "#mod", tostring(FarmingHubLive.modVersion or ""))
    xml:setInt(r .. "#seq", self.seq)
    xml:setInt(r .. "#ack", self.inboxSeq)
    xml:setString(r .. "#saveDir", tostring(self.saveName or ""))
    xml:setString(r .. "#mapTitle", tostring(info.mapTitle or ""))
    xml:setString(r .. "#time", getDate("%Y-%m-%d %H:%M:%S"))
    local env = mission.environment
    if env ~= nil then
        xml:setInt(r .. "#day", env.currentMonotonicDay or env.currentDay or 0)
        if type(env.dayTime) == "number" then
            xml:setInt(r .. "#minute", math.floor(env.dayTime / 60000))
        end
    end
    FarmingHubLive.writeSettings(xml, r .. ".settings", self.settings)
    local n = 0
    for _, key in ipairs(sortedKeys(self.problems)) do
        local p = self.problems[key]
        local k = string.format("%s.tasks.task(%d)", r, n)
        n = n + 1
        xml:setString(k .. "#key", key)
        xml:setString(k .. "#kind", p.kind)
        xml:setInt(k .. "#farm", p.farm)
        xml:setString(k .. "#uid", tostring(p.uid))
        xml:setString(k .. "#name", tostring(p.name or ""))
        if p.fill ~= nil then
            xml:setString(k .. "#fill", p.fill)
        end
        if p.fillTitle ~= nil then
            xml:setString(k .. "#fillTitle", tostring(p.fillTitle))
        end
        xml:setInt(k .. "#sev", p.sev or 2)
        if type(p.level) == "number" then
            xml:setString(k .. "#level", num(p.level, 0))
        end
        if type(p.cap) == "number" then
            xml:setString(k .. "#cap", num(p.cap, 0))
        end
        if type(p.pct) == "number" then
            xml:setString(k .. "#pct", num(p.pct, 1))
        end
        if type(p.hours) == "number" then
            xml:setString(k .. "#hours", num(p.hours, 1))
        end
    end
    xml:setInt(r .. ".tasks#count", n)
    xml:save()
    xml:delete()
    return true
end

function FarmingHubLive:readInbox()
    local dir = self:dir()
    if dir == nil then
        return
    end
    local file = dir .. "/" .. FarmingHubLive.INBOX
    if not fileExists(file) then
        return
    end
    local xml = XMLFile.load("farmingHubInbox", file)
    if xml == nil then
        return
    end
    local r = "farmingHubInbox"
    local seq = xml:getInt(r .. "#seq") or 0
    if seq ~= self.inboxSeq then
        local rev = xml:getInt(r .. ".settings#rev")
        if rev ~= nil and rev > (self.settings.rev or 0) then
            self.settings = FarmingHubLive.readSettings(xml, r .. ".settings")
            self:saveSettings()
            log("Einstellungen vom Hub übernommen (rev %d, Export %s, Produktionsberater %s)", rev, self.settings.export and "an" or "aus", self.settings.advisor and "an" or "aus")
        end
        local tasks = {}
        local i = 0
        while xml:hasProperty(string.format("%s.tasks.task(%d)", r, i)) do
            local k = string.format("%s.tasks.task(%d)", r, i)
            table.insert(tasks, { id = xml:getInt(k .. "#id"), farm = xml:getInt(k .. "#farm") or 0, title = xml:getString(k .. "#title") or "",
                note = xml:getString(k .. "#note"), due = xml:getString(k .. "#due"), assignee = xml:getString(k .. "#assignee"), field = xml:getInt(k .. "#field") })
            i = i + 1
        end
        local notes = {}
        i = 0
        while xml:hasProperty(string.format("%s.notes.note(%d)", r, i)) do
            local k = string.format("%s.notes.note(%d)", r, i)
            table.insert(notes, { id = xml:getInt(k .. "#id"), by = xml:getString(k .. "#by") or "", text = xml:getString(k .. "#text") or "" })
            i = i + 1
        end
        local dismissed = {}
        i = 0
        while xml:hasProperty(string.format("%s.dismissed.game(%d)", r, i)) do
            local key = xml:getString(string.format("%s.dismissed.game(%d)#key", r, i))
            if key ~= nil then
                dismissed[key] = true
            end
            i = i + 1
        end
        self.hubTasks, self.hubNotes, self.dismissed = tasks, notes, dismissed
        self.inboxSeq = seq
    end
    xml:delete()
end

-- ---------- Takt ----------
function FarmingHubLive:loadMap(filename)
    local mod = g_modManager ~= nil and g_modManager:getModByName(FarmingHubLive.modName) or nil
    FarmingHubLive.modVersion = mod ~= nil and mod.version or nil
    addConsoleCommand("hubStatus", "Farming Hub: Einstellungen, offene Aufgaben, Aufgaben und Notizen aus dem Hub", "consoleStatus", FarmingHubLive)
    addConsoleCommand("hubSet", "Farming Hub: hubSet export|advisor on|off, hubSet <Hof> <Schlüssel> <Wert>", "consoleSet", FarmingHubLive)
    if g_currentMission ~= nil and g_currentMission:getIsServer() then
        try("Einstellungen laden", self.loadSettings, self)
        try("Inbox", self.readInbox, self)
    end
end

function FarmingHubLive:deleteMap()
    removeConsoleCommand("hubStatus")
    removeConsoleCommand("hubSet")
    self.exchangeDir = nil
    self.saveName = nil
    self.problems = {}
    self.blocked = {}
    self.lastSig = nil
end

function FarmingHubLive:update(dt)
    if g_currentMission == nil or not g_currentMission:getIsServer() then
        return
    end
    local t = self.timers
    t.check = t.check + dt
    t.write = t.write + dt
    t.beat = t.beat + dt
    t.read = t.read + dt
    if t.read >= FarmingHubLive.READ_MS then
        t.read = 0
        try("Inbox", self.readInbox, self)
    end
    if t.check >= FarmingHubLive.CHECK_MS then
        t.check = 0
        try("Prüfen", self.check, self)
    end
    if t.write >= FarmingHubLive.WRITE_MS then
        t.write = 0
        local sig = self:signature()
        if sig ~= self.lastSig or t.beat >= FarmingHubLive.BEAT_MS then
            if self:writeLive() then
                self.lastSig = sig
                t.beat = 0
            end
        end
    end
end

-- ---------- Konsole ----------
function FarmingHubLive:consoleStatus()
    local s = self.settings
    local lines = { string.format("Farming Hub: Export %s, Produktionsberater %s, Einstellungen rev %d, Ordner %s", s.export and "an" or "aus", s.advisor and "an" or "aus",
        s.rev or 0, tostring(self:dir())) }
    for _, key in ipairs(sortedKeys(self.problems)) do
        local p = self.problems[key]
        table.insert(lines, string.format("  [%s] %s %s %s%s", p.kind, p.name, tostring(p.fillTitle or p.fill or ""), p.pct ~= nil and num(p.pct, 0) .. " %" or "",
            p.hours ~= nil and " / " .. num(p.hours, 1) .. " h" or ""))
    end
    table.insert(lines, string.format("Vom Hub (Inbox %d): %d Aufgaben, %d Notizen", self.inboxSeq, #self.hubTasks, #self.hubNotes))
    for _, h in ipairs(self.hubTasks) do
        table.insert(lines, string.format("  Aufgabe %s (Hof %d): %s", tostring(h.id), h.farm or 0, h.title))
    end
    for _, n in ipairs(self.hubNotes) do
        table.insert(lines, string.format("  Notiz %s: %s", n.by, n.text))
    end
    return table.concat(lines, "\n")
end

function FarmingHubLive:consoleSet(a, b, c)
    if g_currentMission == nil or not g_currentMission:getIsServer() then
        return "hubSet: nur auf dem Server oder im Einzelspieler"
    end
    local s = self.settings
    if a == "export" or a == "advisor" then
        s[a] = bool(b)
    else
        local farm = tonumber(a)
        local kind = nil
        for _, kv in ipairs(FarmingHubLive.FARM_KEYS) do
            if kv[1] == b then
                kind = type(kv[2])
            end
        end
        if farm == nil or kind == nil or c == nil then
            return "hubSet export|advisor on|off  oder  hubSet <Hof> <input|inputHours|inputPct|output|outputPct|pallets|stall|stallPct|stallFullPct|silo|siloPct> <Wert>"
        end
        s.farms[farm] = s.farms[farm] or {}
        s.farms[farm][b] = kind == "boolean" and bool(c) or tonumber(c)
    end
    s.rev = (s.rev or 0) + 1
    self:saveSettings()
    self.timers.check = FarmingHubLive.CHECK_MS
    self.timers.write = FarmingHubLive.WRITE_MS
    return string.format("hubSet: gespeichert (rev %d)", s.rev)
end

-- Paletten-Ausgänge: Rückmeldung jedes Versuchs mitlesen (nichts am Ablauf ändern)
local function wrapSpawner(name)
    if PalletSpawner == nil or type(PalletSpawner[name]) ~= "function" then
        return
    end
    local original = PalletSpawner[name]
    PalletSpawner[name] = function(spawner, farmId, fillTypeId, callback, callbackTarget, ...)
        local cb = callback
        if type(callback) == "function" then
            cb = function(target, pallet, result, fillType, ...)
                pcall(FarmingHubLive.onPalletResult, FarmingHubLive, target, result, fillType or fillTypeId)
                return callback(target, pallet, result, fillType, ...)
            end
        end
        return original(spawner, farmId, fillTypeId, cb, callbackTarget, ...)
    end
end
wrapSpawner("spawnPallet")
wrapSpawner("getOrSpawnPallet")

FarmingHubLive.modName = g_currentModName
addModEventListener(FarmingHubLive)
