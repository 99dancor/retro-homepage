-- FS25 Hub Link: Overlay im Spiel (ab Mod 3.1)
--
-- Dezente Liste am rechten Rand, im Stil der Spiel-Anzeigen (dunkle, halbdurchsichtige Kästen, weiße Schrift, orange
-- Akzente): Meldungen des Produktionsberaters, Aufgaben und Notizen aus dem Hub, nur für den eigenen Hof.
--
--   Alt+H   Overlay: klein (bis 4 Einträge) → groß (bis 12, mit Notizen) → aus
--   Alt+J   nächsten Eintrag auswählen
--   Alt+K   ausgewählten Eintrag abhaken (Meldung: bis das Problem weg ist; Hub-Aufgabe: im Hub erledigt; Notiz: ausblenden)
--
-- Tasten lassen sich in den Steuerungs-Einstellungen ändern. Ohne Tasten geht es über die Konsole: hubHud, hubDone.
-- Was jeder Spieler eingestellt hat (Größe, Position, ausgeblendete Notizen), liegt nur bei ihm in
-- modSettings/FS25_FarmingHubExport/hubLinkHud.xml.

HubLinkHud = {}
HubLinkHud.FILE = "hubLinkHud.xml"
HubLinkHud.SELECT_MS = 10000
HubLinkHud.mode = 1
HubLinkHud.x = 0.988
HubLinkHud.y = 0.79
HubLinkHud.sel = 0
HubLinkHud.selTime = -1
HubLinkHud.pending = {}
HubLinkHud.hiddenNotes = {}
HubLinkHud.names = {}
HubLinkHud.rows = {}
HubLinkHud.flash = nil

-- Farben wie die Spiel-Anzeigen
local C = {
    bg = { 0.12, 0.12, 0.12, 0.72 },
    bgSel = { 0.26, 0.26, 0.26, 0.86 },
    chip = { 0.05, 0.05, 0.05, 0.82 },
    text = { 1, 1, 1, 1 },
    dim = { 0.72, 0.72, 0.72, 1 },
    accent = { 0.91, 0.64, 0.2, 1 },
    red = { 0.9, 0.32, 0.26, 1 },
    blue = { 0.55, 0.75, 0.95, 1 },
    grey = { 0.6, 0.6, 0.6, 1 },
}

local function T(key, fallback)
    if g_i18n ~= nil and g_i18n.hasText ~= nil and g_i18n:hasText(key) then
        return g_i18n:getText(key)
    end
    return fallback
end

-- ---------- Maße (Bezug 1080 Pixel Höhe, mit UI-Größe des Spiels) ----------
local function scale()
    local s = 1
    pcall(function()
        s = g_gameSettings:getValue(GameSettings.SETTING.UI_SCALE) or 1
    end)
    return s
end
local function py(v)
    return v / 1080 * scale()
end
local function px(v)
    local w, h = g_screenWidth or 1920, g_screenHeight or 1080
    return v / 1080 * scale() * h / w
end

local function rect(x, y, w, h, c)
    if drawFilledRect ~= nil then
        drawFilledRect(x, y, w, h, c[1], c[2], c[3], c[4])
    end
end

-- Kasten mit abgeschrägten Ecken (wirkt wie die abgerundeten Kästen des Spiels)
local function box(x, y, w, h, c)
    if drawFilledRect == nil then
        return
    end
    local r = math.min(px(3), w / 4)
    local ry = math.min(py(3), h / 4)
    drawFilledRect(x + r, y, w - 2 * r, h, c[1], c[2], c[3], c[4])
    drawFilledRect(x, y + ry, r, h - 2 * ry, c[1], c[2], c[3], c[4])
    drawFilledRect(x + w - r, y + ry, r, h - 2 * ry, c[1], c[2], c[3], c[4])
end

-- letztes UTF-8-Zeichen weg
local function chop(s)
    return (string.gsub(s, "[%z\1-\127\194-\244][\128-\191]*$", ""))
end
local function fit(text, size, width)
    if getTextWidth(size, text) <= width then
        return text
    end
    while #text > 1 and getTextWidth(size, text .. "...") > width do
        text = chop(text)
    end
    return text .. "..."
end

local function text(x, y, size, s, c, bold, align)
    setTextBold(bold == true)
    setTextColor(c[1], c[2], c[3], c[4])
    setTextAlignment(align or RenderText.ALIGN_LEFT)
    renderText(x, y, size, s)
end

-- ---------- Texte ----------
-- Gebäudename: beim Spieler nachschlagen (dann in seiner Sprache), sonst wie der Server ihn schickt
function HubLinkHud:placeName(e)
    if e.uid ~= nil and e.uid ~= "" and self.names[e.uid] ~= nil then
        return self.names[e.uid]
    end
    return e.name ~= "" and e.name or T("hubLink_building", "Gebäude")
end

local function goodName(e)
    if e.fill ~= nil and e.fill ~= "" and g_fillTypeManager ~= nil then
        local ft = g_fillTypeManager:getFillTypeByName(e.fill)
        if ft ~= nil and ft.title ~= nil then
            return ft.title
        end
    end
    return e.fillTitle ~= "" and e.fillTitle or "?"
end

local function hours(h)
    if h < 1 then
        return T("hubLink_lessHour", "unter 1 Std.")
    elseif h < 48 then
        return string.format(T("hubLink_hours", "%d Std."), math.floor(h + 0.5))
    end
    return string.format(T("hubLink_days", "%d Tage"), math.floor(h / 24 + 0.5))
end

function HubLinkHud:textOf(e)
    if e.src == 2 or e.src == 3 then
        return e.title
    end
    local place, pct = self:placeName(e), math.floor((e.pct or -1) + 0.5)
    local k = e.kind
    if k == "input" then
        if e.hours >= 0 then
            return string.format(T("hubLink_input", "%s: %s reicht noch %s"), place, goodName(e), hours(e.hours))
        end
        return string.format(T("hubLink_inputPct", "%s: %s fast leer (%d %%)"), place, goodName(e), pct)
    elseif k == "stopped" then
        return string.format(T("hubLink_stopped", "%s steht: %s fehlt"), place, goodName(e))
    elseif k == "output" or k == "product" then
        local good = k == "product" and (e.fillTitle ~= "" and e.fillTitle or "?") or goodName(e)
        if pct >= 99 then
            return string.format(T("hubLink_full", "%s: %s voll"), place, good)
        end
        return string.format(T("hubLink_almostFull", "%s: %s fast voll (%d %%)"), place, good, pct)
    elseif k == "blocked" then
        return string.format(T("hubLink_blocked", "%s: Paletten-Ausgang blockiert"), place)
    elseif k == "food" then
        if pct < 1 then
            return string.format(T("hubLink_foodEmpty", "%s: Futter leer"), place)
        end
        return string.format(T("hubLink_food", "%s: Futter knapp (%d %%)"), place, pct)
    elseif k == "supply" then
        local good = e.fillTitle ~= "" and e.fillTitle or "?"
        if pct < 1 then
            return string.format(T("hubLink_empty", "%s: %s leer"), place, good)
        end
        return string.format(T("hubLink_low", "%s: %s knapp (%d %%)"), place, good, pct)
    elseif k == "pallets" then
        return string.format(T("hubLink_pallets", "%s: kein Platz für Paletten"), place)
    elseif k == "silo" then
        return string.format(T("hubLink_almostFull", "%s: %s fast voll (%d %%)"), place, goodName(e), pct)
    end
    return place
end

-- ---------- Liste ----------
-- Neue Liste vom Server: Namen der Gebäude neu nachschlagen, Auswahl behalten, wenn der Eintrag noch da ist
function HubLinkHud:onView()
    local keep = self.rows[self.sel] ~= nil and self.rows[self.sel].key or nil
    self.pending = {}
    self.names = {}
    pcall(function()
        for _, p in ipairs(g_currentMission.placeableSystem.placeables) do
            local uid = p.getUniqueId ~= nil and p:getUniqueId() or p.uniqueId
            if uid ~= nil and p.getName ~= nil then
                self.names[tostring(uid)] = p:getName()
            end
        end
    end)
    self:refresh()
    self.sel = 0
    for i, r in ipairs(self.rows) do
        if r.key == keep then
            self.sel = i
        end
    end
end

local function myFarm()
    local id = 0
    pcall(function()
        id = g_currentMission:getFarmId() or 0
    end)
    if FarmManager ~= nil and id == FarmManager.SPECTATOR_FARM_ID then
        return 0
    end
    return id
end

function HubLinkHud:refresh()
    local farm, rows, notes = myFarm(), {}, {}
    if farm > 0 then
        local list = FarmingHubLive ~= nil and FarmingHubLive.viewList or {}
        local order = {}
        for i, e in ipairs(list) do
            local wait = self.pending[e.key]
            if (wait == nil or g_time - wait > 15000) and (e.farm == farm or e.farm == 0) then
                if e.src == 3 then
                    if not self.hiddenNotes[e.key] then
                        table.insert(notes, e)
                    end
                else
                    table.insert(order, { e = e, i = i })
                end
            end
        end
        -- Wichtiges zuerst: steht / blockiert, dann knapp, dann Aufgaben aus dem Hub
        table.sort(order, function(a, b)
            if a.e.src ~= b.e.src then
                return a.e.src < b.e.src
            end
            if a.e.sev ~= b.e.sev then
                return a.e.sev > b.e.sev
            end
            return a.i < b.i
        end)
        for _, o in ipairs(order) do
            table.insert(rows, o.e)
        end
        if self.mode == 2 then
            for i = 1, math.min(3, #notes) do
                table.insert(rows, notes[i])
            end
        end
    end
    self.rows = rows
end

function HubLinkHud:selecting()
    return self.sel > 0 and self.selTime >= 0 and g_time - self.selTime < HubLinkHud.SELECT_MS
end

-- ---------- Tasten ----------
function HubLinkHud:onToggle()
    self.mode = (self.mode + 1) % 3
    self:refresh()
    self:savePrefs()
end

function HubLinkHud:onNext()
    if self.mode == 0 then
        self.mode = 1
        self:savePrefs()
    end
    self:refresh()
    local max = math.min(#self.rows, self.mode == 2 and 12 or 4)
    if max == 0 then
        self.sel = 0
        return
    end
    if not self:selecting() then
        self.sel = 1
    else
        self.sel = self.sel % max + 1
    end
    self.selTime = g_time
end

local function localUser()
    local u = { name = "", farm = myFarm(), master = false }
    pcall(function()
        u.master = g_currentMission.isMasterUser == true or g_currentMission:getIsServer()
        local user = g_currentMission.userManager:getUserByUserId(g_currentMission.playerUserId)
        u.name = user:getNickname() or ""
    end)
    if u.name == "" and g_currentMission ~= nil and g_currentMission.playerNickname ~= nil then
        u.name = g_currentMission.playerNickname
    end
    return u
end

function HubLinkHud:onDone()
    if not self:selecting() then
        -- erst auswählen, dann abhaken: ein Druck ohne Auswahl wählt den obersten Eintrag
        self:onNext()
        return
    end
    self:tick(self.rows[self.sel])
end

function HubLinkHud:tick(e)
    if e == nil then
        return false
    end
    if e.src == 3 then
        self.hiddenNotes[e.key] = true
        self:savePrefs()
    elseif not HubLinkDoneEvent.send(e.key, localUser()) then
        return false
    end
    self.pending[e.key] = g_time
    self.flash = { text = string.format(T("hubLink_ticked", "Abgehakt: %s"), self:textOf(e)), t = g_time }
    self:refresh()
    self.sel = math.min(self.sel, #self.rows)
    self.selTime = self.sel > 0 and g_time or -1
    return true
end

local function action(fn)
    return function(target, actionName, inputValue)
        fn(HubLinkHud)
    end
end

function HubLinkHud.registerActions()
    if g_inputBinding == nil or InputAction == nil or InputAction.HUBLINK_TOGGLE == nil then
        return
    end
    for _, a in ipairs({ { InputAction.HUBLINK_TOGGLE, HubLinkHud.onToggle }, { InputAction.HUBLINK_NEXT, HubLinkHud.onNext }, { InputAction.HUBLINK_DONE, HubLinkHud.onDone } }) do
        local ok, id = g_inputBinding:registerActionEvent(a[1], HubLinkHud, action(a[2]), false, true, false, true)
        if ok and id ~= nil then
            g_inputBinding:setActionEventTextVisibility(id, false)
        end
    end
end

-- Zu Fuß und im Fahrzeug: FS25 meldet globale Aktionen über PlayerInputComponent, ältere Stände über FSBaseMission
if PlayerInputComponent ~= nil and PlayerInputComponent.registerGlobalPlayerActionEvents ~= nil then
    PlayerInputComponent.registerGlobalPlayerActionEvents = Utils.appendedFunction(PlayerInputComponent.registerGlobalPlayerActionEvents, function()
        pcall(HubLinkHud.registerActions)
    end)
elseif FSBaseMission ~= nil and FSBaseMission.registerActionEvents ~= nil then
    FSBaseMission.registerActionEvents = Utils.appendedFunction(FSBaseMission.registerActionEvents, function()
        pcall(HubLinkHud.registerActions)
    end)
end

-- ---------- Einstellungen des Spielers ----------
function HubLinkHud:prefsFile()
    if getUserProfileAppPath == nil then
        return nil
    end
    local base = getUserProfileAppPath() .. "modSettings"
    createFolder(base)
    base = base .. "/" .. FarmingHubLive.MOD_DIR
    createFolder(base)
    return base .. "/" .. HubLinkHud.FILE
end

function HubLinkHud:loadPrefs()
    local file = self:prefsFile()
    if file == nil or not fileExists(file) then
        return
    end
    local xml = XMLFile.load("hubLinkHud", file)
    if xml == nil then
        return
    end
    self.mode = math.max(0, math.min(2, xml:getInt("hubLinkHud#mode") or 1))
    self.x = math.max(0.2, math.min(1, xml:getFloat("hubLinkHud#x") or HubLinkHud.x))
    self.y = math.max(0.2, math.min(1, xml:getFloat("hubLinkHud#y") or HubLinkHud.y))
    local i = 0
    while xml:hasProperty(string.format("hubLinkHud.hidden(%d)", i)) do
        local key = xml:getString(string.format("hubLinkHud.hidden(%d)#key", i))
        if key ~= nil then
            self.hiddenNotes[key] = true
        end
        i = i + 1
    end
    xml:delete()
end

function HubLinkHud:savePrefs()
    local file = self:prefsFile()
    if file == nil then
        return
    end
    local xml = XMLFile.create("hubLinkHud", file, "hubLinkHud")
    if xml == nil then
        return
    end
    xml:setInt("hubLinkHud#mode", self.mode)
    xml:setFloat("hubLinkHud#x", self.x)
    xml:setFloat("hubLinkHud#y", self.y)
    -- nur Notizen, die es noch gibt
    local live = {}
    for _, e in ipairs(FarmingHubLive.viewList or {}) do
        live[e.key] = true
    end
    local n = 0
    for key in pairs(self.hiddenNotes) do
        if live[key] or #(FarmingHubLive.viewList or {}) == 0 then
            xml:setString(string.format("hubLinkHud.hidden(%d)#key", n), key)
            n = n + 1
        end
    end
    xml:save()
    xml:delete()
end

-- ---------- Zeichnen ----------
function HubLinkHud:visible()
    if self.mode == 0 or g_currentMission == nil or g_dedicatedServer ~= nil then
        return false
    end
    if g_gui ~= nil and g_gui.getIsGuiVisible ~= nil and g_gui:getIsGuiVisible() then
        return false
    end
    if g_noHudModeEnabled then
        return false
    end
    local hud = g_currentMission.hud
    if hud ~= nil and hud.getIsVisible ~= nil and not hud:getIsVisible() then
        return false
    end
    return true
end

function HubLinkHud:draw()
    if not self:visible() then
        return
    end
    local rows = self.rows
    local max = self.mode == 2 and 12 or 4
    local flash = self.flash ~= nil and g_time - self.flash.t < 3000
    if #rows == 0 and self.mode == 1 and not flash then
        return
    end
    local w = px(390)
    local x = self.x - w
    local y = self.y
    local headH, rowH, gap, pad = py(34), py(30), py(4), px(12)
    local size, small = py(15), py(13)

    -- Kopf: HUB LINK · HOF n, rechts die Zahl im dunklen Feld (wie das Geld in der Zeitleiste)
    local farm = myFarm()
    y = y - headH
    box(x, y, w, headH, C.bg)
    local chipW = px(46)
    box(x + w - chipW, y, chipW, headH, C.chip)
    local ty = y + (headH - size) / 2 + size * 0.18
    rect(x + pad, y + headH * 0.3, px(3), headH * 0.4, C.accent)
    text(x + pad + px(10), ty, size, string.upper(string.format(T("hubLink_head", "Hub Link · Hof %d"), farm)), C.text, true)
    local hot = false
    for _, r in ipairs(rows) do
        if r.src == 1 and r.sev >= 3 then
            hot = true
        end
    end
    local count = 0
    for _, r in ipairs(rows) do
        if r.src ~= 3 then
            count = count + 1
        end
    end
    text(x + w - chipW / 2, ty, size, tostring(count), hot and C.red or (count > 0 and C.accent or C.text), true, RenderText.ALIGN_CENTER)

    -- Zeilen
    local selecting = self:selecting()
    local shown = math.min(#rows, max)
    for i = 1, shown do
        local e = rows[i]
        y = y - gap - rowH
        local sel = selecting and i == self.sel
        box(x, y, w, rowH, sel and C.bgSel or C.bg)
        local stripe = e.src == 3 and C.grey or e.src == 2 and C.blue or (e.sev >= 3 and C.red or C.accent)
        rect(x + px(6), y + rowH * 0.22, px(3), rowH * 0.56, stripe)
        local tx = x + pad + px(4)
        local label = self:textOf(e)
        local sub = (self.mode == 2 and e.sub ~= nil and e.sub ~= "") and e.sub or nil
        local subW = 0
        if sub ~= nil then
            sub = fit(sub, small, px(120))
            subW = getTextWidth(small, sub) + px(8)
            text(x + w - pad, y + (rowH - small) / 2 + small * 0.18, small, sub, C.dim, false, RenderText.ALIGN_RIGHT)
        end
        if e.src == 3 then
            label = T("hubLink_note", "Notiz") .. ": " .. label
        end
        text(tx, y + (rowH - size) / 2 + size * 0.18, size, fit(label, size, w - (tx - x) - pad - subW), sel and C.accent or C.text, sel)
    end
    if #rows > shown then
        y = y - gap - py(22)
        text(x + w - pad, y + py(5), small, string.format(T("hubLink_more", "+%d weitere"), #rows - shown), C.dim, false, RenderText.ALIGN_RIGHT)
    end
    if #rows == 0 and not flash then
        y = y - gap - rowH
        box(x, y, w, rowH, C.bg)
        text(x + pad + px(4), y + (rowH - size) / 2 + size * 0.18, size, T("hubLink_allOk", "Alles in Ordnung"), C.dim, false)
    end
    -- Rückmeldung nach dem Abhaken, sonst Tastenhinweis beim Auswählen
    if flash then
        y = y - gap - py(22)
        text(x + w - pad, y + py(5), small, fit(self.flash.text, small, w - 2 * pad), C.accent, false, RenderText.ALIGN_RIGHT)
    elseif selecting then
        y = y - gap - py(22)
        text(x + w - pad, y + py(5), small, T("hubLink_hint", "Alt+J weiter · Alt+K abhaken"), C.dim, false, RenderText.ALIGN_RIGHT)
    end
    setTextBold(false)
    setTextColor(1, 1, 1, 1)
    setTextAlignment(RenderText.ALIGN_LEFT)
end

-- ---------- Ablauf ----------
function HubLinkHud:loadMap()
    pcall(self.loadPrefs, self)
    addConsoleCommand("hubHud", "Hub Link: Overlay 0 (aus) | 1 (klein) | 2 (groß) | pos <x> <y>", "consoleHud", HubLinkHud)
    addConsoleCommand("hubDone", "Hub Link: Eintrag Nr. <n> im Overlay abhaken", "consoleDone", HubLinkHud)
end

function HubLinkHud:deleteMap()
    removeConsoleCommand("hubHud")
    removeConsoleCommand("hubDone")
    self.rows = {}
    self.pending = {}
    self.sel = 0
end

function HubLinkHud:update(dt)
    -- Hof gewechselt o. Ä.: Liste ab und zu neu filtern
    self.refreshT = (self.refreshT or 0) + dt
    if self.refreshT > 2000 then
        self.refreshT = 0
        local keep = self.rows[self.sel] ~= nil and self.rows[self.sel].key or nil
        self:refresh()
        if keep ~= nil and (self.rows[self.sel] == nil or self.rows[self.sel].key ~= keep) then
            self.sel = 0
            for i, r in ipairs(self.rows) do
                if r.key == keep then
                    self.sel = i
                end
            end
        end
    end
end

function HubLinkHud:consoleHud(a, b, c)
    if a == "pos" and tonumber(b) ~= nil and tonumber(c) ~= nil then
        self.x = math.max(0.2, math.min(1, tonumber(b)))
        self.y = math.max(0.2, math.min(1, tonumber(c)))
    elseif tonumber(a) ~= nil then
        self.mode = math.max(0, math.min(2, math.floor(tonumber(a))))
    else
        self.mode = (self.mode + 1) % 3
    end
    self:refresh()
    self:savePrefs()
    return string.format("hubHud: Größe %d, Position %.3f %.3f", self.mode, self.x, self.y)
end

function HubLinkHud:consoleDone(n)
    self:refresh()
    local i = tonumber(n) or (self:selecting() and self.sel) or nil
    local e = i ~= nil and self.rows[i] or nil
    if e == nil then
        local lines = { "hubDone <Nr>:" }
        for k, r in ipairs(self.rows) do
            table.insert(lines, string.format("  %d  %s", k, self:textOf(r)))
        end
        return table.concat(lines, "\n")
    end
    local label = self:textOf(e)
    if self:tick(e) then
        return "hubDone: abgehakt: " .. label
    end
    return "hubDone: nicht erlaubt (anderer Hof?)"
end

addModEventListener(HubLinkHud)
