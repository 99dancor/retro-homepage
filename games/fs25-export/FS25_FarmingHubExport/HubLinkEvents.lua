-- FS25 Hub Link: Netzwerk (ab Mod 3.1)
--
-- Der Produktionsberater läuft nur auf dem Server. Damit jeder Spieler das Overlay sieht, schickt der Server die Liste
-- (FarmingHubLive.viewList) an alle, sobald sie sich ändert, und einem neuen Spieler beim Beitreten. Hakt ein Spieler etwas
-- ab, geht nur der Schlüssel an den Server; der prüft, ob der Spieler zu dem Hof gehört.

local function cut(s, n)
    s = tostring(s or "")
    if #s <= n then
        return s
    end
    s = string.sub(s, 1, n)
    -- kein halbes UTF-8-Zeichen am Ende
    while #s > 0 do
        local b = string.byte(s, #s)
        if b < 128 then
            break
        end
        s = string.sub(s, 1, #s - 1)
        if b >= 192 then
            break
        end
    end
    return s
end

-- ---------- Server → Spieler: die ganze Liste ----------
HubLinkSyncEvent = {}
local HubLinkSyncEvent_mt = Class(HubLinkSyncEvent, Event)
InitEventClass(HubLinkSyncEvent, "HubLinkSyncEvent")

function HubLinkSyncEvent.emptyNew()
    return Event.new(HubLinkSyncEvent_mt)
end

function HubLinkSyncEvent.new(list)
    local self = HubLinkSyncEvent.emptyNew()
    self.list = list or {}
    return self
end

function HubLinkSyncEvent:writeStream(streamId, connection)
    local n = math.min(#self.list, 60)
    streamWriteUInt8(streamId, n)
    for i = 1, n do
        local e = self.list[i]
        streamWriteString(streamId, cut(e.key, 200))
        streamWriteUInt8(streamId, e.src or 1)
        streamWriteUInt8(streamId, math.max(0, math.min(255, e.farm or 0)))
        streamWriteUInt8(streamId, e.sev or 0)
        streamWriteString(streamId, cut(e.kind, 20))
        streamWriteString(streamId, cut(e.uid, 80))
        streamWriteString(streamId, cut(e.name, 80))
        streamWriteString(streamId, cut(e.fill, 40))
        streamWriteString(streamId, cut(e.fillTitle, 60))
        streamWriteString(streamId, cut(e.title, 160))
        streamWriteString(streamId, cut(e.sub, 80))
        streamWriteFloat32(streamId, e.pct or -1)
        streamWriteFloat32(streamId, e.hours or -1)
    end
end

function HubLinkSyncEvent:readStream(streamId, connection)
    local n = streamReadUInt8(streamId)
    self.list = {}
    for _ = 1, n do
        local e = {}
        e.key = streamReadString(streamId)
        e.src = streamReadUInt8(streamId)
        e.farm = streamReadUInt8(streamId)
        e.sev = streamReadUInt8(streamId)
        e.kind = streamReadString(streamId)
        e.uid = streamReadString(streamId)
        e.name = streamReadString(streamId)
        e.fill = streamReadString(streamId)
        e.fillTitle = streamReadString(streamId)
        e.title = streamReadString(streamId)
        e.sub = streamReadString(streamId)
        e.pct = streamReadFloat32(streamId)
        e.hours = streamReadFloat32(streamId)
        table.insert(self.list, e)
    end
    self:run(connection)
end

function HubLinkSyncEvent:run(connection)
    -- nur beim Spieler, vom Server gekommen
    if connection ~= nil and connection:getIsServer() then
        FarmingHubLive.viewList = self.list
        if HubLinkHud ~= nil then
            HubLinkHud:onView()
        end
    end
end

-- ---------- Spieler → Server: abgehakt ----------
HubLinkDoneEvent = {}
local HubLinkDoneEvent_mt = Class(HubLinkDoneEvent, Event)
InitEventClass(HubLinkDoneEvent, "HubLinkDoneEvent")

function HubLinkDoneEvent.emptyNew()
    return Event.new(HubLinkDoneEvent_mt)
end

function HubLinkDoneEvent.new(key)
    local self = HubLinkDoneEvent.emptyNew()
    self.key = key
    return self
end

function HubLinkDoneEvent:writeStream(streamId, connection)
    streamWriteString(streamId, cut(self.key, 200))
end

function HubLinkDoneEvent:readStream(streamId, connection)
    self.key = streamReadString(streamId)
    self:run(connection)
end

function HubLinkDoneEvent:run(connection)
    -- nur auf dem Server, von einem Spieler gekommen
    if connection == nil or connection:getIsServer() then
        return
    end
    local by, farm, master = "", 0, false
    pcall(function()
        local user = g_currentMission.userManager:getUserByConnection(connection)
        by = user:getNickname() or ""
        master = user:getIsMasterUser() == true
        local f = g_farmManager:getFarmByUserId(user:getId())
        farm = f ~= nil and f.farmId or 0
    end)
    FarmingHubLive:markDone(self.key, by, farm, master)
end

-- Abhaken von hier aus: Server/Einzelspieler direkt, sonst an den Server
function HubLinkDoneEvent.send(key, user)
    if g_currentMission ~= nil and g_currentMission:getIsServer() then
        return FarmingHubLive:markDone(key, user.name, user.farm, user.master)
    end
    if g_client ~= nil then
        g_client:getServerConnection():sendEvent(HubLinkDoneEvent.new(key))
        return true
    end
    return false
end

-- Neuer Spieler: aktuelle Liste gleich mitschicken
if FSBaseMission ~= nil and FSBaseMission.sendInitialClientState ~= nil then
    FSBaseMission.sendInitialClientState = Utils.appendedFunction(FSBaseMission.sendInitialClientState, function(mission, connection, ...)
        pcall(function()
            connection:sendEvent(HubLinkSyncEvent.new(FarmingHubLive.viewList or {}))
        end)
    end)
end
