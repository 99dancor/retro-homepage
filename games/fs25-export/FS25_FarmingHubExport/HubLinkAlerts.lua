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
-- Die Vorhersage steckt je nach Spielstand in weather.forecastItems (Typ als typeName, objectIndex oder weatherType) oder
-- nur in weather.forecast:dataForTime(Tag, Zeit). Die 3.8 fand im Spiel nichts; ab 3.9 versucht die Mod alle Wege und
-- schreibt in die Live-Datei, was sie am Wetter sieht (<environment><weatherDebug>).
local function typeName(v)
    if type(v) == "string" then
        return string.upper(v)
    end
    if type(v) == "table" then
        return typeName(v.name or v.typeName or v.weatherType)
    end
    if type(v) == "number" then
        if g_weatherTypeManager ~= nil and g_weatherTypeManager.getWeatherTypeByIndex ~= nil then
            local ok, wt = pcall(g_weatherTypeManager.getWeatherTypeByIndex, g_weatherTypeManager, v)
            if ok and type(wt) == "table" and (wt.name or wt.typeName) ~= nil then
                return string.upper(tostring(wt.name or wt.typeName))
            end
        end
        if type(WeatherType) == "table" then
            for k, n in pairs(WeatherType) do
                if n == v and type(k) == "string" then
                    return string.upper(k)
                end
            end
        end
    end
    return nil
end

local function itemName(item)
    return typeName(item.typeName) or typeName(item.weatherType) or typeName(item.objectIndex) or typeName(item.type) or typeName(item.weatherObject)
end

-- Kommende Wetterabschnitte: { name, start (ms ab jetzt), finish }
function FarmingHubLive.forecastList()
    local env = g_currentMission ~= nil and g_currentMission.environment or nil
    local weather = env ~= nil and env.weather or nil
    local out = {}
    if weather == nil then
        return out
    end
    local day = env.currentMonotonicDay or env.currentDay or 0
    local now = type(env.dayTime) == "number" and env.dayTime or 0
    local H = 3600000
    for _, item in ipairs(weather.forecastItems or {}) do
        local name = itemName(item)
        if name ~= nil then
            local start = ((item.startDay or day) - day) * 24 * H + (item.startDayTime or 0) - now
            table.insert(out, { name = name, start = start, finish = start + (item.duration or 0) })
        end
    end
    if #out == 0 and type(weather.forecast) == "table" and weather.forecast.dataForTime ~= nil then
        for h = 0, 12 do
            local t = now + h * H
            local d = day + math.floor(t / (24 * H))
            local ok, data = pcall(weather.forecast.dataForTime, weather.forecast, d, t % (24 * H))
            local name = ok and type(data) == "table" and (typeName(data.weatherType) or typeName(data.typeName)) or nil
            if name ~= nil then
                table.insert(out, { name = name, start = h * H, finish = (h + 1) * H })
            end
        end
    end
    return out
end

-- Was die Mod am Wetter sieht (Namen, keine Inhalte)
function FarmingHubLive.weatherDebug()
    local env = g_currentMission ~= nil and g_currentMission.environment or nil
    local weather = env ~= nil and env.weather or nil
    local function keys(t)
        local o = {}
        for k, v in pairs(t or {}) do
            if type(k) == "string" then
                local tv = type(v)
                table.insert(o, (tv == "number" or tv == "boolean" or tv == "string") and (k .. "=" .. string.sub(tostring(v), 1, 30)) or (k .. ":" .. string.sub(tv, 1, 1)))
            end
        end
        table.sort(o)
        return string.sub(table.concat(o, " "), 1, 1500)
    end
    if weather == nil then
        return { weather = "nil" }
    end
    local items = weather.forecastItems
    return { weather = keys(weather), items = tostring(type(items) == "table" and #items or type(items)), item = type(items) == "table" and type(items[1]) == "table" and keys(items[1]) or "",
        forecast = type(weather.forecast) == "table" and keys(weather.forecast) or tostring(type(weather.forecast)) }
end

-- Stunden bis zum nächsten Regen (0 = regnet gerade) und die Art, oder nil, wenn in den nächsten „ahead“ Stunden keiner kommt
function FarmingHubLive.rainSoon(ahead)
    local H = 3600000
    local best, bestName = nil, nil
    for _, w in ipairs(FarmingHubLive.forecastList()) do
        if FarmingHubLive.RAIN_TYPES[w.name] and w.finish > 0 and w.start <= ahead * H then
            local h = math.max(0, w.start) / H
            if best == nil or h < best then
                best, bestName = h, w.name
            end
        end
    end
    -- Regnet es gerade, auch ohne Vorhersage
    if best == nil then
        local env = g_currentMission ~= nil and g_currentMission.environment or nil
        local weather = env ~= nil and env.weather or nil
        local ok, scale = false, nil
        if weather ~= nil and weather.getRainFallScale ~= nil then
            ok, scale = pcall(weather.getRainFallScale, weather)
        end
        if ok and type(scale) == "number" and scale > 0.1 then
            best, bestName = 0, "RAIN"
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
            -- ab 3.12 je Hof, dem Land unter den Reihen gehört
            local shares = FarmingHubLive.orchardShares ~= nil and FarmingHubLive.orchardShares(o) or { { farm = o.farm, ripe = o.ripe } }
            for _, f in ipairs(shares) do
                if farmOk(f.farm) and self:farm(f.farm).rain ~= false and (f.ripe or 0) >= 10 then
                    local g = farmOf(f.farm)
                    table.insert(g.places, o.name ~= "" and o.name or (o.fruitTitle or "?"))
                    if g.x == nil then
                        g.x, g.z = o.x, o.z
                    end
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
