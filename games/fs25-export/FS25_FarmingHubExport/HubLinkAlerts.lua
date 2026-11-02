-- FS25 Hub Link: Helfer-Meldungen und Regen-Warnung (ab Mod 3.8)
--
-- Helfer   Hält ein KI-Helfer an, schickt das Spiel auf dem Server die Nachricht AI_JOB_STOPPED mit dem Auftrag und dem
--          Grund (AIMessage...). Fehler (kein Sprit, blockiert, Feld nicht bereit, Tank voll …) werden zur Aufgabe mit
--          dem Text des Spiels, „fertig“ (Auftrag erledigt, Silo leer) zu einem leisen Hinweis, der nach 15 Minuten
--          verschwindet. Vom Spieler selbst beendet: nichts. Startet der Helfer wieder oder hakt jemand ab, ist sie weg.
-- Regen    Reife Felder oder erntereife Plantagen und Regen, Gewitter, Hagel oder Schnee in der Vorhersage der nächsten
--          RAIN_HOURS Spielstunden (oder jetzt): eine Aufgabe je Hof mit allen betroffenen Feldern.
-- Orte     Jede Meldung bekommt, wenn bekannt, einen Ort (x, z) für die Markierung auf der Karte im Overlay.

local U = FarmingHubLive.U

FarmingHubLive.helpers = {}
FarmingHubLive.HELPER_DONE_MS = 900000
FarmingHubLive.RAIN_HOURS = 6
FarmingHubLive.RAIN_TYPES = { RAIN = true, THUNDER = true, HAIL = true, SNOW = true }

-- Grund des Halts als kurzer Code für den Hub (Reihenfolge egal, erster Treffer zählt)
local AI_CODES = {
    { "AIMessageSuccessStoppedByUser", "byUser" }, { "AIMessageSuccessFinishedJob", "finished" }, { "AIMessageSuccessSiloEmpty", "siloEmpty" },
    { "AIMessageErrorOutOfFuel", "outOfFuel" }, { "AIMessageErrorOutOfFill", "outOfFill" }, { "AIMessageErrorOutOfMoney", "outOfMoney" },
    { "AIMessageErrorBlockedByObject", "blocked" }, { "AIMessageErrorNotReachable", "notReachable" }, { "AIMessageErrorFieldNotReady", "fieldNotReady" },
    { "AIMessageErrorFieldNotOwned", "fieldNotOwned" }, { "AIMessageErrorGraintankIsFull", "tankFull" }, { "AIMessageErrorVehicleBroken", "broken" },
    { "AIMessageErrorUnloadingStationFull", "stationFull" }, { "AIMessageErrorPalletsFull", "palletsFull" }, { "AIMessageErrorWrongSeason", "wrongSeason" },
    { "AIMessageErrorImplementWrongWay", "wrongWay" }, { "AIMessageErrorThreshingNotAllowed", "noThreshing" }, { "AIMessageErrorNoFieldFound", "noField" },
    { "AIMessageErrorCouldNotPrepare", "notPrepared" }, { "AIMessageErrorNoValidFillTypeLoaded", "wrongFill" }, { "AIMessageErrorNoPalletsLoaded", "noPallets" },
    { "AIMessageErrorLoadingStationDeleted", "stationGone" }, { "AIMessageErrorUnloadingStationDeleted", "stationGone" }, { "AIMessageErrorVehicleDeleted", "vehicleGone" },
    { "AIMessageErrorNoVineFound", "noVine" }, { "AIMessageErrorVineyardNotSupported", "noVine" }, { "AIMessageErrorUnknown", "unknown" },
}

local function codeOf(msg)
    if type(msg) ~= "table" then
        return "unknown"
    end
    local mt = getmetatable(msg)
    for _, c in ipairs(AI_CODES) do
        local cls = rawget(_G, c[1])
        if cls ~= nil then
            local hit = false
            pcall(function()
                hit = (msg.isa ~= nil and msg:isa(cls)) or (mt ~= nil and mt.__index == cls)
            end)
            if hit then
                return c[2]
            end
        end
    end
    return "unknown"
end
FarmingHubLive.aiCodeOf = codeOf

local function posOfNode(node)
    if node == nil or node == 0 or getWorldTranslation == nil then
        return nil, nil
    end
    local ok, x, _, z = pcall(getWorldTranslation, node)
    if ok and type(x) == "number" and type(z) == "number" then
        return x, z
    end
    return nil, nil
end
FarmingHubLive.posOfNode = posOfNode

local function jobVehicle(job)
    local v = nil
    pcall(function()
        if job.vehicleParameter ~= nil then
            v = job.vehicleParameter:getVehicle()
        end
    end)
    return v
end

local function helperKey(job, v)
    if v ~= nil then
        local id = (v.getUniqueId ~= nil and v:getUniqueId()) or v.uniqueId or v.id
        if id ~= nil then
            return tostring(id)
        end
    end
    return "h" .. tostring(job ~= nil and job.helperIndex or 0)
end

function FarmingHubLive:initHelpers()
    if self.helperSub or g_messageCenter == nil or MessageType == nil or MessageType.AI_JOB_STOPPED == nil then
        return
    end
    g_messageCenter:subscribe(MessageType.AI_JOB_STOPPED, self.onJobStopped, self)
    if MessageType.AI_JOB_STARTED ~= nil then
        g_messageCenter:subscribe(MessageType.AI_JOB_STARTED, self.onJobStarted, self)
    end
    self.helperSub = true
end

function FarmingHubLive:doneHelpers()
    if self.helperSub and g_messageCenter ~= nil then
        pcall(g_messageCenter.unsubscribeAll, g_messageCenter, self)
    end
    self.helperSub = nil
    self.helpers = {}
end

function FarmingHubLive:onJobStarted(job)
    if g_currentMission == nil or not g_currentMission:getIsServer() or job == nil then
        return
    end
    U.try("Helfer Start", function()
        local k = helperKey(job, jobVehicle(job))
        if self.helpers[k] ~= nil then
            self.helpers[k] = nil
            self.timers.check = FarmingHubLive.CHECK_MS
        end
    end)
end

function FarmingHubLive:onJobStopped(job, msg)
    if g_currentMission == nil or not g_currentMission:getIsServer() or job == nil then
        return
    end
    U.try("Helfer Stopp", function()
        local v = jobVehicle(job)
        local k = helperKey(job, v)
        local code = codeOf(msg)
        if code == "byUser" then
            self.helpers[k] = nil
            return
        end
        local typ = nil
        pcall(function()
            typ = msg:getType()
        end)
        local ok = code == "finished" or code == "siloEmpty" or (AIMessageType ~= nil and typ ~= nil and typ == AIMessageType.OK)
        local text = ""
        pcall(function()
            text = msg:getMessage(job) or ""
        end)
        local name = ""
        pcall(function()
            name = (v ~= nil and v.getName ~= nil and v:getName()) or job:getTitle() or ""
        end)
        local helper = ""
        pcall(function()
            helper = job:getHelperName() or ""
        end)
        local x, z = nil, nil
        if v ~= nil then
            x, z = posOfNode(v.rootNode)
        end
        self.helpers[k] = { farm = job.startedFarmId or 0, uid = k, name = tostring(name), helper = tostring(helper), sub = tostring(text), code = code,
            done = ok, t = g_time, x = x, z = z }
        U.log("Helfer %s (%s): %s", tostring(name), code, tostring(text))
        self.timers.check = FarmingHubLive.CHECK_MS
    end)
end

local function farmOk(farm)
    return type(farm) == "number" and farm >= 1 and farm <= 8
end

function FarmingHubLive:checkHelpers(found)
    for k, h in pairs(self.helpers) do
        if h.done and g_time - h.t > FarmingHubLive.HELPER_DONE_MS then
            self.helpers[k] = nil
        elseif farmOk(h.farm) and self:farm(h.farm).helper ~= false then
            local p = { kind = h.done and "helperDone" or "helper", farm = h.farm, uid = h.uid, part = h.code, name = h.name, fill = h.code, fillTitle = h.helper,
                sub = h.sub, sev = h.done and 1 or 3, x = h.x, z = h.z, file = "", custom = "" }
            self:add(found, p)
            if self.seen[p.key] then
                -- abgehakt: vergessen, beim nächsten Durchgang ist die Meldung weg
                self.helpers[k] = nil
            end
        end
    end
end

-- ---------- Regen ----------
local function weatherName(item)
    local name = item.typeName
    if name == nil and g_weatherTypeManager ~= nil and item.objectIndex ~= nil then
        local ok, wt = pcall(g_weatherTypeManager.getWeatherTypeByIndex, g_weatherTypeManager, item.objectIndex)
        name = ok and wt ~= nil and wt.name or nil
    end
    return name ~= nil and string.upper(tostring(name)) or nil
end

-- Stunden bis zum nächsten Regen (0 = regnet gerade) und die Art, oder nil, wenn in den nächsten „ahead“ Stunden keiner kommt
function FarmingHubLive.rainSoon(ahead)
    local env = g_currentMission ~= nil and g_currentMission.environment or nil
    local weather = env ~= nil and env.weather or nil
    if weather == nil then
        return nil
    end
    local day = env.currentMonotonicDay or env.currentDay or 0
    local now = type(env.dayTime) == "number" and env.dayTime or 0
    local H = 3600000
    local best, bestName = nil, nil
    for _, item in ipairs(weather.forecastItems or {}) do
        local name = weatherName(item)
        if name ~= nil and FarmingHubLive.RAIN_TYPES[name] then
            local start = ((item.startDay or day) - day) * 24 * H + (item.startDayTime or 0) - now
            local finish = start + (item.duration or 0)
            if finish > 0 and start <= ahead * H then
                local h = math.max(0, start) / H
                if best == nil or h < best then
                    best, bestName = h, name
                end
            end
        end
    end
    return best, bestName
end

function FarmingHubLive:checkRain(found)
    local hrs, what = FarmingHubLive.rainSoon(FarmingHubLive.RAIN_HOURS)
    if hrs == nil then
        return
    end
    local farms = {}
    local function farmOf(id)
        if farms[id] == nil then
            farms[id] = { ids = {}, places = {} }
        end
        return farms[id]
    end
    for _, f in ipairs(self:readFields()) do
        if f.ripe and farmOk(f.farm) and self:farm(f.farm).rain ~= false then
            local g = farmOf(f.farm)
            table.insert(g.ids, f.id)
            if g.x == nil then
                g.x, g.z = f.x, f.z
            end
        end
    end
    if self.readOrchards ~= nil then
        for _, o in ipairs(self:readOrchards()) do
            if farmOk(o.farm) and self:farm(o.farm).rain ~= false and (o.ripe or 0) >= 10 then
                local g = farmOf(o.farm)
                table.insert(g.places, o.name ~= "" and o.name or (o.fruitTitle or "?"))
                if g.x == nil then
                    g.x, g.z = o.x, o.z
                end
            end
        end
    end
    for farm, g in pairs(farms) do
        table.sort(g.ids)
        local names = {}
        for i, id in ipairs(g.ids) do
            if i <= 12 then
                table.insert(names, tostring(id))
            end
        end
        local name = table.concat(names, ", ") .. (#g.ids > 12 and " …" or "")
        self:add(found, { kind = "rain", farm = farm, uid = "rain", part = "rain", name = name, fill = what or "RAIN", fillTitle = "", sub = table.concat(g.places, ", "),
            hours = hrs, level = #g.ids, cap = #g.places, sev = 3, x = g.x, z = g.z, file = "", custom = "" })
    end
end
