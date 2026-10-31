-- FS25 Hub Link: Overlay im Spiel (ab Mod 3.1, Maus und Optionen ab 3.2)
--
-- Dezente Liste im Stil der Spiel-Anzeigen (dunkle, halbdurchsichtige Kästen, weiße Schrift, orange Akzente): Meldungen
-- des Produktionsberaters mit ihren Werten, Aufgaben und Notizen aus dem Hub, nur für den eigenen Hof.
--
-- Bedienung mit der Maus, sobald der Mauszeiger zu sehen ist (z. B. Doppel-Rechtsklick mit „Quick Selector“, oder Alt+J):
--   Kopf ziehen        Fenster verschieben
--   Ecke unten rechts  Breite und Anzahl der Zeilen ziehen
--   OK                 Eintrag abhaken (Meldung: bis das Problem weg ist; Hub-Aufgabe: im Hub erledigt; Notiz: ausblenden)
--   OPTIONEN           Optionsmenü: Anzeige (nur für mich), Prüfungen und Schwellen des Hofs, Export und Berater (Admin)
--   X                  Overlay ausblenden (Alt+H holt es zurück)
--
-- Tasten (in der Steuerung änderbar): Alt+H Overlay ein/aus, Alt+J Mauszeiger ein/aus. Konsole: hubHud, hubDone.
-- Was jeder Spieler für die Anzeige eingestellt hat, liegt nur bei ihm in modSettings/FS25_FarmingHubExport/hubLinkHud.xml.

HubLinkHud = {}
HubLinkHud.FILE = "hubLinkHud.xml"
HubLinkHud.prefs = { visible = true, x = 0.74, y = 0.79, w = 420, rows = 5, scale = 1, alpha = 0.72, details = true, notes = true, accent = 1, round = true }
HubLinkHud.optTab = nil
HubLinkHud.hiddenNotes = {}
HubLinkHud.pending = {}
HubLinkHud.rows = {}
HubLinkHud.hits = {}
HubLinkHud.options = false
HubLinkHud.ownCursor = false
HubLinkHud.drag = nil
HubLinkHud.mx, HubLinkHud.my = -1, -1
HubLinkHud.flash = nil

local C = {
    bg = { 0.12, 0.12, 0.12, 0.72 },
    bgHover = { 0.24, 0.24, 0.24, 0.86 },
    chip = { 0.05, 0.05, 0.05, 0.82 },
    text = { 1, 1, 1, 1 },
    dim = { 0.72, 0.72, 0.72, 1 },
    off = { 0.45, 0.45, 0.45, 1 },
    accent = { 0.91, 0.64, 0.2, 1 },
    onAccent = { 0.08, 0.08, 0.08, 1 },
    red = { 0.9, 0.32, 0.26, 1 },
    blue = { 0.55, 0.75, 0.95, 1 },
    grey = { 0.6, 0.6, 0.6, 1 },
}

-- Hervorhebungsfarben zur Wahl (ab 3.4): Orange wie das Spiel, dann Grün, Blau, Türkis, Rot, Lila
local ACCENTS = {
    { 0.91, 0.64, 0.2, 1 }, { 0.6, 0.8, 0.22, 1 }, { 0.36, 0.64, 0.96, 1 }, { 0.22, 0.78, 0.72, 1 }, { 0.92, 0.38, 0.32, 1 }, { 0.68, 0.5, 0.95, 1 },
}
HubLinkHud.ACCENTS = ACCENTS
local function useAccent(i)
    C.accent = ACCENTS[i] or ACCENTS[1]
end

-- Grenzen wie im Hub (src/fslive.js LIMITS) und Schrittweite der Knöpfe
local STEPS = {
    inputHours = { 1, 240, 1 }, inputPct = { 1, 90, 5 }, outputPct = { 10, 100, 5 }, stallPct = { 1, 90, 5 }, stallFullPct = { 10, 100, 5 }, siloPct = { 10, 100, 5 },
}
HubLinkHud.STEPS = STEPS

local function T(key, fallback)
    if g_i18n ~= nil and g_i18n.hasText ~= nil and g_i18n:hasText(key) then
        return g_i18n:getText(key)
    end
    return fallback
end

local function fmt(n)
    n = math.floor((n or 0) + 0.5)
    local ok, s = pcall(function()
        return g_i18n:formatNumber(n, 0)
    end)
    if ok and type(s) == "string" then
        return s
    end
    local t = tostring(n)
    local out = t:reverse():gsub("(%d%d%d)", "%1."):reverse()
    return (out:gsub("^%.", ""))
end

-- ---------- Maße (Bezug 1080 Pixel Höhe, mit UI-Größe des Spiels und eigener Schriftgröße) ----------
local function uiScale()
    local s = 1
    pcall(function()
        s = g_gameSettings:getValue(GameSettings.SETTING.UI_SCALE) or 1
    end)
    return s * (HubLinkHud.prefs.scale or 1)
end
local function py(v)
    return v / 1080 * uiScale()
end
local function px(v)
    local w, h = g_screenWidth or 1920, g_screenHeight or 1080
    return v / 1080 * uiScale() * h / w
end

local function rect(x, y, w, h, c, a)
    if drawFilledRect ~= nil then
        drawFilledRect(x, y, w, h, c[1], c[2], c[3], a or c[4])
    end
end

-- Kasten mit abgerundeten Ecken (ab 3.4): oben und unten je eine Handvoll Streifen, die zur Ecke hin schmaler werden.
-- Die Kanten liegen auf ganzen Bildschirmpixeln, damit sich die halbdurchsichtigen Streifen weder überlappen noch Lücken lassen.
local function snapY(v)
    local h = g_screenHeight or 1080
    return math.floor(v * h + 0.5) / h
end
local function box(x, y, w, h, c, a, radius)
    if drawFilledRect == nil then
        return
    end
    a = a or c[4]
    local r = radius or 7
    if not HubLinkHud.prefs.round then
        r = 2
    end
    local ry = math.min(py(r), h / 2)
    local rx = math.min(px(r), w / 2)
    local n = math.max(1, math.min(7, math.floor(ry * (g_screenHeight or 1080) + 0.5)))
    local y0, y1 = snapY(y), snapY(y + h)
    local b0, t0 = snapY(y + ry), snapY(y + h - ry)
    if t0 > b0 then
        drawFilledRect(x, b0, w, t0 - b0, c[1], c[2], c[3], a)
    end
    for i = 0, n - 1 do
        local d = 1 - (i + 0.5) / n
        local inset = rx * (1 - math.sqrt(math.max(0, 1 - d * d)))
        local lo, hi = snapY(y0 + (b0 - y0) * i / n), snapY(y0 + (b0 - y0) * (i + 1) / n)
        if hi > lo then
            drawFilledRect(x + inset, lo, w - 2 * inset, hi - lo, c[1], c[2], c[3], a)
        end
        lo, hi = snapY(y1 - (y1 - t0) * (i + 1) / n), snapY(y1 - (y1 - t0) * i / n)
        if hi > lo then
            drawFilledRect(x + inset, lo, w - 2 * inset, hi - lo, c[1], c[2], c[3], a)
        end
    end
end

-- Großbuchstaben mit Umlauten (string.upper kennt nur ASCII)
local function upper(s)
    if utf8ToUpper ~= nil then
        return utf8ToUpper(s)
    end
    s = string.upper(s)
    return (s:gsub("ä", "Ä"):gsub("ö", "Ö"):gsub("ü", "Ü"))
end

local function chop(s)
    return (string.gsub(s, "[%z\1-\127\194-\244][\128-\191]*$", ""))
end
local function fit(text, size, width)
    if width <= 0 then
        return ""
    end
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

-- Text senkrecht mittig in einer Zeile der Höhe h
local function mid(y, h, size)
    return y + (h - size) / 2 + size * 0.18
end

-- ---------- Klickflächen ----------
function HubLinkHud:hit(x, y, w, h, fn, drag)
    table.insert(self.hits, { x = x, y = y, w = w, h = h, fn = fn, drag = drag })
end

function HubLinkHud:over(x, y, w, h)
    return self.mx >= x and self.mx <= x + w and self.my >= y and self.my <= y + h
end

-- kleiner Knopf mit Text, hebt sich unter der Maus hervor
function HubLinkHud:button(x, y, w, h, label, fn, on, enabled)
    enabled = enabled ~= false
    local hover = enabled and self:over(x, y, w, h)
    box(x, y, w, h, on and C.accent or (hover and C.bgHover or C.chip), on and 0.92 or nil, 5)
    local size = math.min(py(13), h * 0.6)
    text(x + w / 2, mid(y, h, size), size, label, on and C.onAccent or (enabled and (hover and C.accent or C.text) or C.off), true, RenderText.ALIGN_CENTER)
    if enabled then
        self:hit(x, y, w, h, fn)
    end
end

-- ---------- Texte ----------
local function goodName(e)
    if e.fill ~= nil and e.fill ~= "" and g_fillTypeManager ~= nil and g_fillTypeManager.getFillTypeByName ~= nil then
        local ft = g_fillTypeManager:getFillTypeByName(e.fill)
        if ft ~= nil and ft.title ~= nil then
            return ft.title
        end
    end
    return e.fillTitle ~= "" and e.fillTitle or "?"
end

-- Gebäude in der Sprache des Spielers: eigener Name, sonst Shop-Name aus der Gebäude-Datei, sonst wie vom Server
function HubLinkHud:placeName(e)
    if e.custom ~= nil and e.custom ~= "" then
        return e.custom
    end
    if e.file ~= nil and e.file ~= "" and g_storeManager ~= nil then
        local ok, item = pcall(function()
            local file = e.file
            if NetworkUtil ~= nil and NetworkUtil.convertFromNetworkFilename ~= nil then
                file = NetworkUtil.convertFromNetworkFilename(file)
            end
            return g_storeManager:getItemByXMLFilename(file)
        end)
        if ok and item ~= nil and item.name ~= nil and item.name ~= "" then
            return item.name
        end
    end
    return e.name ~= "" and e.name or T("hubLink_building", "Gebäude")
end

local function hours(h)
    if h < 1 then
        return T("hubLink_lessHour", "unter 1 Std.")
    elseif h < 48 then
        return string.format(T("hubLink_hours", "%d Std."), math.floor(h + 0.5))
    end
    return string.format(T("hubLink_days", "%d Tage"), math.floor(h / 24 + 0.5))
end

-- Feld-Meldungen (ab 3.4): Arbeit und die Felder, die sie brauchen
local FIELD_KINDS = {
    harvest = { "hubLink_harvestWork", "Ernten" }, lime = { "hubLink_lime", "Kalken" }, plow = { "hubLink_plow", "Pflügen" },
    fertilize = { "hubLink_fertilize", "Düngen" }, weed = { "hubLink_weed", "Unkraut bekämpfen" },
}

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
    elseif FIELD_KINDS[k] ~= nil then
        local where = string.format(string.find(e.name or "", ",") and T("hubLink_fieldsMany", "Felder %s") or T("hubLink_fieldsOne", "Feld %s"), e.name or "")
        if k == "harvest" then
            return string.format(T("hubLink_harvest", "%s ernten: %s"), goodName(e), where)
        end
        return string.format("%s: %s", T(FIELD_KINDS[k][1], FIELD_KINDS[k][2]), where)
    end
    return place
end

-- Zweite Zeile: die Werte und die Grenze, die die Meldung ausgelöst hat
function HubLinkHud:detailOf(e)
    if e.src == 2 or e.src == 3 then
        return e.sub or ""
    end
    local cfg = FarmingHubLive:farm(e.farm)
    local bits = {}
    if (e.level or -1) >= 0 and (e.cap or 0) > 0 then
        table.insert(bits, string.format(T("hubLink_level", "%s / %s l"), fmt(e.level), fmt(e.cap)))
    end
    if (e.pct or -1) >= 0 and e.kind ~= "stopped" then
        table.insert(bits, string.format("%d %%", math.floor(e.pct + 0.5)))
    end
    local k = e.kind
    if k == "input" then
        if e.hours >= 0 then
            table.insert(bits, string.format(T("hubLink_limitBelow", "Grenze unter %s"), string.format(T("hubLink_hours", "%d Std."), cfg.inputHours)))
        else
            table.insert(bits, string.format(T("hubLink_limitBelow", "Grenze unter %s"), cfg.inputPct .. " %"))
        end
    elseif k == "stopped" then
        table.insert(bits, T("hubLink_stoppedHint", "Produktion wartet auf Nachschub"))
    elseif k == "output" then
        table.insert(bits, string.format(T("hubLink_limitFrom", "Grenze ab %s"), cfg.outputPct .. " %"))
    elseif k == "product" then
        table.insert(bits, string.format(T("hubLink_limitFrom", "Grenze ab %s"), cfg.stallFullPct .. " %"))
    elseif k == "food" or k == "supply" then
        table.insert(bits, string.format(T("hubLink_limitBelow", "Grenze unter %s"), cfg.stallPct .. " %"))
    elseif k == "silo" then
        table.insert(bits, string.format(T("hubLink_limitFrom", "Grenze ab %s"), cfg.siloPct .. " %"))
    elseif k == "blocked" then
        table.insert(bits, T("hubLink_blockedHint", "Palette passt nicht aus dem Ausgang"))
    elseif k == "pallets" then
        table.insert(bits, T("hubLink_palletsHint", "Palettenplatz am Stall voll"))
    elseif FIELD_KINDS[k] ~= nil then
        table.insert(bits, T("hubLink_fieldHint", "laut Feldzustand im Spiel"))
    end
    return table.concat(bits, "  ·  ")
end

-- ---------- Liste ----------
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
HubLinkHud.myFarm = myFarm

function HubLinkHud:onView()
    self.pending = {}
    self:refresh()
end

function HubLinkHud:refresh()
    local farm, rows, notes = myFarm(), {}, {}
    if farm > 0 then
        local order = {}
        for i, e in ipairs(FarmingHubLive ~= nil and FarmingHubLive.viewList or {}) do
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
        -- Wichtiges zuerst: steht / blockiert, dann knapp, dann Aufgaben aus dem Hub, dann Notizen
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
        if self.prefs.notes then
            for i = 1, math.min(3, #notes) do
                table.insert(rows, notes[i])
            end
        end
    end
    self.rows = rows
end

-- ---------- Abhaken ----------
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
HubLinkHud.localUser = localUser

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
    return true
end

-- ---------- Optionen ändern ----------
function HubLinkHud:setPref(key, value)
    self.prefs[key] = value
    if key == "accent" then
        useAccent(value)
    end
    self:refresh()
    self:savePrefs()
end

function HubLinkHud:stepPref(key, delta, lo, hi)
    local v = math.max(lo, math.min(hi, (self.prefs[key] or 0) + delta))
    self:setPref(key, math.floor(v * 100 + 0.5) / 100)
end

-- Einstellung des Hofs (oder global mit farm 0) an den Server; die Antwort kommt mit der nächsten Liste
function HubLinkHud:setFarm(farm, key, value)
    HubLinkSetEvent.send(farm, key, value, localUser())
end

function HubLinkHud:stepFarm(farm, key, dir)
    local s = STEPS[key]
    local cur = FarmingHubLive:farm(farm)[key] or s[1]
    local step = s[3]
    if key == "inputHours" and cur + dir > 24 then
        step = 6
    end
    local v = math.max(s[1], math.min(s[2], cur + dir * step))
    if v ~= cur then
        self:setFarm(farm, key, v)
    end
end

-- ---------- Tasten ----------
function HubLinkHud:onToggle()
    self:setPref("visible", not self.prefs.visible)
end

function HubLinkHud:cursorShown()
    local shown = false
    pcall(function()
        shown = g_inputBinding:getShowMouseCursor() == true
    end)
    return shown or self.ownCursor
end

function HubLinkHud:onMouse()
    self.ownCursor = not self.ownCursor
    pcall(function()
        g_inputBinding:setShowMouseCursor(self.ownCursor)
    end)
    if self.ownCursor and not self.prefs.visible then
        self:setPref("visible", true)
    end
end

local function action(fn)
    return function()
        fn(HubLinkHud)
    end
end

function HubLinkHud.registerActions()
    if g_inputBinding == nil or InputAction == nil or InputAction.HUBLINK_TOGGLE == nil then
        return
    end
    for _, a in ipairs({ { InputAction.HUBLINK_TOGGLE, HubLinkHud.onToggle }, { InputAction.HUBLINK_MOUSE, HubLinkHud.onMouse } }) do
        if a[1] ~= nil then
            local ok, id = g_inputBinding:registerActionEvent(a[1], HubLinkHud, action(a[2]), false, true, false, true)
            if ok and id ~= nil then
                g_inputBinding:setActionEventTextVisibility(id, false)
            end
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

local function clamp(v, lo, hi, d)
    if type(v) ~= "number" then
        return d
    end
    return math.max(lo, math.min(hi, v))
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
    local p, r = self.prefs, "hubLinkHud"
    local vis = xml:getBool(r .. "#visible")
    if vis ~= nil then
        p.visible = vis
    end
    p.x = clamp(xml:getFloat(r .. "#x"), 0, 0.95, p.x)
    p.y = clamp(xml:getFloat(r .. "#y"), 0.1, 1, p.y)
    p.w = clamp(xml:getFloat(r .. "#w"), 260, 900, p.w)
    p.rows = math.floor(clamp(xml:getFloat(r .. "#rows"), 1, 15, p.rows))
    p.scale = clamp(xml:getFloat(r .. "#scale"), 0.7, 1.5, p.scale)
    p.alpha = clamp(xml:getFloat(r .. "#alpha"), 0.3, 0.95, p.alpha)
    local d = xml:getBool(r .. "#details")
    if d ~= nil then
        p.details = d
    end
    local n = xml:getBool(r .. "#notes")
    if n ~= nil then
        p.notes = n
    end
    p.accent = math.floor(clamp(xml:getFloat(r .. "#accent"), 1, #ACCENTS, p.accent))
    local rd = xml:getBool(r .. "#round")
    if rd ~= nil then
        p.round = rd
    end
    useAccent(p.accent)
    local i = 0
    while xml:hasProperty(string.format("%s.hidden(%d)", r, i)) do
        local key = xml:getString(string.format("%s.hidden(%d)#key", r, i))
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
    local p, r = self.prefs, "hubLinkHud"
    xml:setBool(r .. "#visible", p.visible)
    xml:setFloat(r .. "#x", p.x)
    xml:setFloat(r .. "#y", p.y)
    xml:setFloat(r .. "#w", p.w)
    xml:setFloat(r .. "#rows", p.rows)
    xml:setFloat(r .. "#scale", p.scale)
    xml:setFloat(r .. "#alpha", p.alpha)
    xml:setBool(r .. "#details", p.details)
    xml:setBool(r .. "#notes", p.notes)
    xml:setFloat(r .. "#accent", p.accent)
    xml:setBool(r .. "#round", p.round)
    local live, list = {}, FarmingHubLive.viewList or {}
    for _, e in ipairs(list) do
        live[e.key] = true
    end
    local n = 0
    for key in pairs(self.hiddenNotes) do
        if live[key] or #list == 0 then
            xml:setString(string.format("%s.hidden(%d)#key", r, n), key)
            n = n + 1
        end
    end
    xml:save()
    xml:delete()
end

-- ---------- Zeichnen ----------
function HubLinkHud:visible()
    if not self.prefs.visible or g_currentMission == nil or g_dedicatedServer ~= nil then
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
    self.hits = {}
    if not self:visible() then
        return
    end
    local p = self.prefs
    local mouse = self:cursorShown()
    local flash = self.flash ~= nil and g_time - self.flash.t < 3000
    local rows = self.rows
    if #rows == 0 and not mouse and not flash and not self.options then
        return
    end
    local alpha = p.alpha
    local w = px(p.w)
    local x = p.x
    local y = p.y
    local headH, gap, pad = py(34), py(4), px(12)
    local size, small = py(15), py(12.5)
    local rowH = p.details and py(46) or py(30)

    -- Kopf: HUB LINK · HOF n, rechts die Zahl im dunklen Feld (wie das Geld in der Zeitleiste)
    local farm = myFarm()
    y = y - headH
    box(x, y, w, headH, C.bg, alpha)
    local chipW = px(46)
    box(x + w - chipW - px(4), y + py(4), chipW, headH - py(8), C.chip, nil, 5)
    box(x + pad, y + headH * 0.28, px(4), headH * 0.44, C.accent, nil, 2)
    local count, hot = 0, false
    for _, r in ipairs(rows) do
        if r.src ~= 3 then
            count = count + 1
        end
        if r.src == 1 and r.sev >= 3 then
            hot = true
        end
    end
    text(x + w - chipW / 2 - px(4), mid(y, headH, size), size, tostring(count), hot and C.red or (count > 0 and C.accent or C.text), true, RenderText.ALIGN_CENTER)
    local titleRight = x + w - chipW - px(10)
    if mouse then
        -- Knöpfe im Kopf; der Rest des Kopfs verschiebt das Fenster
        local bh = headH * 0.7
        local bx = titleRight - px(26)
        self:button(bx, y + (headH - bh) / 2, px(26), bh, "X", function()
            self.options = false
            self:setPref("visible", false)
        end)
        local ow = px(92)
        bx = bx - px(4) - ow
        self:button(bx, y + (headH - bh) / 2, ow, bh, upper(T("hubLink_options", "Optionen")), function()
            self.options = not self.options
        end, self.options)
        titleRight = bx - px(6)
        self:hit(x, y, titleRight - x, headH, nil, "move")
    end
    local title = upper(string.format(T("hubLink_head", "Hub Link · Hof %d"), farm))
    text(x + pad + px(10), mid(y, headH, size), size, fit(title, size, titleRight - x - pad - px(10)), C.text, true)
    local bottom = y

    -- Zeilen
    local shown = math.min(#rows, p.rows)
    for i = 1, shown do
        local e = rows[i]
        y = y - gap - rowH
        local hover = mouse and self:over(x, y, w, rowH)
        box(x, y, w, rowH, hover and C.bgHover or C.bg, hover and nil or alpha)
        local stripe = e.src == 3 and C.grey or e.src == 2 and C.blue or (e.sev >= 3 and C.red or C.accent)
        box(x + px(6), y + rowH * 0.2, px(4), rowH * 0.6, stripe, nil, 2)
        local tx = x + pad + px(4)
        local right = x + w - pad
        if mouse then
            local bw, bh = px(40), py(22)
            self:button(right - bw, y + (rowH - bh) / 2, bw, bh, e.src == 3 and upper(T("hubLink_hide", "Aus")) or "OK", function()
                self:tick(e)
            end)
            right = right - bw - px(8)
        end
        local label = self:textOf(e)
        if e.src == 3 then
            label = T("hubLink_note", "Notiz") .. ": " .. label
        end
        if p.details then
            local detail = self:detailOf(e)
            text(tx, y + rowH * 0.52 + size * 0.05, size, fit(label, size, right - tx), C.text, false)
            if detail ~= "" then
                text(tx, y + rowH * 0.14, small, fit(detail, small, right - tx), C.dim, false)
            end
        else
            local sub = e.src ~= 1 and e.sub ~= nil and e.sub ~= "" and e.sub or nil
            local subW = 0
            if sub ~= nil then
                sub = fit(sub, small, px(130))
                subW = getTextWidth(small, sub) + px(10)
                text(right, mid(y, rowH, small), small, sub, C.dim, false, RenderText.ALIGN_RIGHT)
            end
            text(tx, mid(y, rowH, size), size, fit(label, size, right - tx - subW), C.text, false)
        end
        bottom = y
    end
    if #rows == 0 then
        y = y - gap - py(30)
        box(x, y, w, py(30), C.bg, alpha)
        text(x + pad + px(4), mid(y, py(30), size), size, T("hubLink_allOk", "Alles in Ordnung"), C.dim, false)
        bottom = y
    end
    local footY = bottom - gap - py(20)
    if #rows > shown then
        text(x + w - pad, footY + py(4), small, string.format(T("hubLink_more", "+%d weitere"), #rows - shown), C.dim, false, RenderText.ALIGN_RIGHT)
    end
    if flash then
        text(x + pad, footY + py(4), small, fit(self.flash.text, small, w * 0.7), C.accent, false)
    end
    -- Griff unten rechts: Breite und Zeilen ziehen
    if mouse then
        local gs = py(12)
        local gx, gy = x + w - px(12), bottom - py(2) - gs
        box(gx, gy, px(12), gs, self:over(gx, gy, px(12), gs) and C.accent or C.dim, 0.9, 3)
        self:hit(gx - px(4), gy - py(4), px(20), gs + py(8), nil, "size")
        self.rowStep = rowH + gap
    end

    if self.options and mouse then
        self:drawOptions(x, p.y, w)
    end
    setTextBold(false)
    setTextColor(1, 1, 1, 1)
    setTextAlignment(RenderText.ALIGN_LEFT)
end

-- ---------- Optionsmenü ----------
function HubLinkHud:drawOptions(ox, oy, ow)
    local w = px(420)
    local x = ox - w - px(10)
    if x < 0.005 then
        x = ox + ow + px(10)
    end
    local lineH, gap, pad = py(30), py(4), px(14)
    local size, small = py(14), py(12)
    local headH, tabH = py(38), py(30)
    local farm = myFarm()
    local user = localUser()
    local canFarm = farm > 0 and (user.master or user.farm == farm)
    local canGlobal = user.master
    local cfg = farm > 0 and FarmingHubLive:farm(farm) or {}
    local s = FarmingHubLive.settings or {}
    local p = self.prefs

    -- Reiter: Anzeige (nur für mich), Hof (Prüfungen), Server (Admin)
    local tabs = { { "view", T("hubLink_tabView", "Anzeige") } }
    if farm > 0 then
        table.insert(tabs, { "farm", string.format(T("hubLink_tabFarm", "Hof %d"), farm) })
    end
    table.insert(tabs, { "server", T("hubLink_tabServer", "Server") })
    local tab = self.optTab
    local valid = false
    for _, t in ipairs(tabs) do
        valid = valid or t[1] == tab
    end
    if not valid then
        tab = farm > 0 and "farm" or "view"
        self.optTab = tab
    end

    -- Inhalt als Gruppen: jede Gruppe ein eigener Kasten, darin Schalter, Regler und Farbfelder
    local groups = {}
    local cur = nil
    local function group(title)
        cur = { title = title, lines = {} }
        table.insert(groups, cur)
    end
    local function toggle(label, on, fn, enabled)
        table.insert(cur.lines, { label = label, toggle = on, fn = fn, enabled = enabled })
    end
    local function stepper(label, value, minus, plus, enabled)
        table.insert(cur.lines, { label = label, value = value, minus = minus, plus = plus, enabled = enabled })
    end
    local function colors()
        table.insert(cur.lines, { colors = true })
    end

    if tab == "view" then
        group(T("hubLink_grpWindow", "Fenster"))
        stepper(T("hubLink_optRows", "Zeilen"), tostring(p.rows), function() self:stepPref("rows", -1, 1, 15) end, function() self:stepPref("rows", 1, 1, 15) end, true)
        stepper(T("hubLink_optScale", "Schriftgröße"), string.format("%d %%", math.floor(p.scale * 100 + 0.5)), function() self:stepPref("scale", -0.1, 0.7, 1.5) end, function() self:stepPref("scale", 0.1, 0.7, 1.5) end, true)
        stepper(T("hubLink_optAlpha", "Deckkraft"), string.format("%d %%", math.floor(p.alpha * 100 + 0.5)), function() self:stepPref("alpha", -0.1, 0.3, 0.95) end, function() self:stepPref("alpha", 0.1, 0.3, 0.95) end, true)
        toggle(T("hubLink_optRound", "Runde Ecken"), p.round, function() self:setPref("round", not p.round) end, true)
        group(T("hubLink_grpColor", "Hervorhebung"))
        colors()
        group(T("hubLink_grpContent", "Inhalt"))
        toggle(T("hubLink_optDetails", "Werte anzeigen"), p.details, function() self:setPref("details", not p.details) end, true)
        toggle(T("hubLink_optNotes", "Notizen anzeigen"), p.notes, function() self:setPref("notes", not p.notes) end, true)
    elseif tab == "farm" then
        local function ft(label, key)
            toggle(label, cfg[key], function() self:setFarm(farm, key, not cfg[key]) end, canFarm)
        end
        local function fs(label, key, unit)
            stepper(label, string.format("%s %s", tostring(math.floor((cfg[key] or 0) + 0.5)), unit), function() self:stepFarm(farm, key, -1) end, function() self:stepFarm(farm, key, 1) end, canFarm and cfg[key] ~= nil)
        end
        group(T("hubLink_optInput", "Eingänge"))
        ft(T("hubLink_optWatch", "Prüfen"), "input")
        fs(T("hubLink_optInputHours", "reicht weniger als"), "inputHours", T("hubLink_unitHours", "Std."))
        fs(T("hubLink_optInputPct", "ohne Verbrauch unter"), "inputPct", "%")
        group(T("hubLink_optOutput", "Ausgänge"))
        ft(T("hubLink_optWatch", "Prüfen"), "output")
        fs(T("hubLink_optOutputPct", "voll ab"), "outputPct", "%")
        ft(T("hubLink_optPallets", "Paletten-Ausgänge"), "pallets")
        group(T("hubLink_optStall", "Ställe"))
        ft(T("hubLink_optWatch", "Prüfen"), "stall")
        fs(T("hubLink_optStallPct", "knapp unter"), "stallPct", "%")
        fs(T("hubLink_optStallFullPct", "voll ab"), "stallFullPct", "%")
        group(T("hubLink_grpMore", "Silos und Felder"))
        ft(T("hubLink_optSilo", "Silos"), "silo")
        fs(T("hubLink_optSiloPct", "voll ab"), "siloPct", "%")
        ft(T("hubLink_optFieldsShort", "Felder (ernten, kalken, pflügen …)"), "fields")
    else
        group(T("hubLink_optServer", "Server (Admin)"))
        toggle(T("hubLink_optAdvisor", "Produktionsberater"), s.advisor ~= false, function() self:setFarm(0, "advisor", not (s.advisor ~= false)) end, canGlobal)
        toggle(T("hubLink_optExport", "Export beim Speichern"), s.export ~= false, function() self:setFarm(0, "export", not (s.export ~= false)) end, canGlobal)
    end
    local hint
    if tab == "view" then
        hint = T("hubLink_hintView", "Gilt nur für dich, auf diesem Rechner.")
    elseif tab == "farm" then
        hint = canFarm and T("hubLink_optHint", "Prüfungen gelten für den ganzen Hof und gehen an die Website.") or T("hubLink_optNoFarm", "Nur Mitglieder des Hofs ändern die Prüfungen.")
    else
        hint = canGlobal and T("hubLink_hintServer", "Gilt für alle Höfe auf dem Server.") or T("hubLink_hintAdmin", "Nur Admins ändern das.")
    end

    -- Höhe ausrechnen, dann zeichnen
    local grpHead, grpPad = py(24), py(6)
    local total = headH + gap + tabH + gap
    for _, g in ipairs(groups) do
        total = total + grpHead + grpPad + #g.lines * (lineH + gap) + gap
    end
    total = total + py(30)
    local top = oy
    box(x, top - total, w, total, C.bg, math.max(p.alpha, 0.88))

    -- Kopf mit Titel und X
    local y = top - headH
    box(x + pad, y + headH * 0.28, px(4), headH * 0.44, C.accent, nil, 2)
    text(x + pad + px(12), mid(y, headH, size * 1.05), size * 1.05, upper(T("hubLink_options", "Optionen")), C.text, true)
    local bh = headH * 0.62
    self:button(x + w - pad - px(28), y + (headH - bh) / 2, px(28), bh, "X", function()
        self.options = false
    end)

    -- Reiter
    y = y - gap - tabH
    local tw = (w - 2 * pad - (#tabs - 1) * px(6)) / #tabs
    for i, t in ipairs(tabs) do
        local tx = x + pad + (i - 1) * (tw + px(6))
        self:button(tx, y, tw, tabH, upper(t[2]), function()
            self.optTab = t[1]
        end, t[1] == tab)
    end
    y = y - gap

    -- Gruppen
    for _, g in ipairs(groups) do
        local gh = grpHead + grpPad + #g.lines * (lineH + gap)
        box(x + pad * 0.6, y - gh, w - pad * 1.2, gh, C.chip, 0.45, 6)
        local gy = y - grpHead
        text(x + pad + px(4), mid(gy, grpHead, small), small, upper(g.title), C.accent, true)
        gy = gy - grpPad * 0.5
        for _, l in ipairs(g.lines) do
            gy = gy - lineH
            local enabled = l.enabled ~= false
            local lx = x + pad + px(4)
            local right = x + w - pad - px(4)
            local lbh = lineH * 0.76
            local by = gy + (lineH - lbh) / 2
            if l.colors then
                local sw, sgap = px(32), px(8)
                for ci, col in ipairs(ACCENTS) do
                    local cx = lx + (ci - 1) * (sw + sgap)
                    local on = p.accent == ci
                    if on then
                        box(cx - px(3), by - py(3), sw + px(6), lbh + py(6), C.text, 0.9, 7)
                    end
                    box(cx, by, sw, lbh, col, 1, 6)
                    self:hit(cx, by, sw, lbh, function()
                        self:setPref("accent", ci)
                    end)
                end
            else
                text(lx, mid(gy, lineH, size), size, fit(l.label, size, right - lx - (l.toggle ~= nil and px(72) or px(150))), enabled and C.text or C.off, false)
                if l.toggle ~= nil then
                    local bw = px(62)
                    self:button(right - bw, by, bw, lbh, l.toggle and upper(T("hubLink_on", "An")) or upper(T("hubLink_off", "Aus")), l.fn, l.toggle, enabled)
                else
                    local bw, vw = px(28), px(78)
                    self:button(right - bw, by, bw, lbh, "+", l.plus, false, enabled)
                    box(right - bw - vw - px(2), by, vw, lbh, C.chip, 0.6, 5)
                    text(right - bw - vw / 2 - px(1), mid(gy, lineH, size), size, l.value, enabled and C.text or C.off, true, RenderText.ALIGN_CENTER)
                    self:button(right - bw - vw - bw - px(4), by, bw, lbh, "-", l.minus, false, enabled)
                end
            end
            gy = gy - gap
        end
        y = y - gh - gap
    end
    text(x + pad, y - py(20), small * 0.95, fit(hint, small * 0.95, w - 2 * pad), C.dim, false)
    -- Klicks auf das Menü sollen nichts darunter treffen
    table.insert(self.hits, 1, { x = x, y = top - total, w = w, h = total, fn = nil })
end

-- ---------- Maus ----------
function HubLinkHud:mouseEvent(posX, posY, isDown, isUp, button)
    self.gotMouse = true
    self:handleMouse(posX, posY, isDown, isUp, button)
end

function HubLinkHud:handleMouse(posX, posY, isDown, isUp, button)
    self.mx, self.my = posX, posY
    if not self:visible() or not self:cursorShown() then
        self.drag = nil
        return
    end
    local p = self.prefs
    local d = self.drag
    if d ~= nil then
        if d.kind == "move" then
            p.x = math.max(0, math.min(0.98 - px(p.w), d.ox + posX - d.sx))
            p.y = math.max(0.15, math.min(1, d.oy + posY - d.sy))
        elseif d.kind == "size" then
            p.w = math.max(260, math.min(900, d.ow + (posX - d.sx) / px(1)))
            if self.rowStep ~= nil and self.rowStep > 0 then
                p.rows = math.max(1, math.min(15, d.orows + math.floor((d.sy - posY) / self.rowStep + 0.5)))
            end
        end
        if isUp then
            self.drag = nil
            self:savePrefs()
        end
        return
    end
    if not isDown or (Input ~= nil and Input.MOUSE_BUTTON_LEFT ~= nil and button ~= Input.MOUSE_BUTTON_LEFT) then
        return
    end
    -- von oben nach unten: zuletzt gezeichnet liegt oben; das Optionsmenü steht vorn in der Liste und fängt Klicks ab
    local menu = self.hits[1]
    local order = {}
    for i = #self.hits, 1, -1 do
        table.insert(order, self.hits[i])
    end
    for _, h in ipairs(order) do
        if posX >= h.x and posX <= h.x + h.w and posY >= h.y and posY <= h.y + h.h then
            if h.drag ~= nil then
                self.drag = { kind = h.drag, sx = posX, sy = posY, ox = p.x, oy = p.y, ow = p.w, orows = p.rows }
                return
            end
            if h.fn ~= nil then
                h.fn()
                return
            end
            if h == menu then
                return
            end
        end
    end
end

-- Falls das Spiel Mausereignisse nicht an Mods weitergibt: Position und linke Taste selbst abfragen
function HubLinkHud:pollMouse()
    if self.gotMouse or g_inputBinding == nil or not self:cursorShown() then
        return
    end
    local x, y = g_inputBinding.mousePosXLast, g_inputBinding.mousePosYLast
    if type(x) ~= "number" or type(y) ~= "number" then
        return
    end
    local down = false
    pcall(function()
        down = Input.isMouseButtonPressed(Input.MOUSE_BUTTON_LEFT) == true
    end)
    local was = self.pollDown == true
    self.pollDown = down
    self:handleMouse(x, y, down and not was, was and not down, Input ~= nil and Input.MOUSE_BUTTON_LEFT or 1)
end

-- ---------- Ablauf ----------
function HubLinkHud:loadMap()
    pcall(self.loadPrefs, self)
    addConsoleCommand("hubHud", "Hub Link: Overlay on|off | pos <x> <y> | rows <n> | reset", "consoleHud", HubLinkHud)
    addConsoleCommand("hubDone", "Hub Link: Eintrag Nr. <n> im Overlay abhaken", "consoleDone", HubLinkHud)
end

function HubLinkHud:deleteMap()
    removeConsoleCommand("hubHud")
    removeConsoleCommand("hubDone")
    if self.ownCursor then
        pcall(function()
            g_inputBinding:setShowMouseCursor(false)
        end)
    end
    self.ownCursor = false
    self.rows = {}
    self.pending = {}
    self.hits = {}
    self.drag = nil
    self.options = false
end

function HubLinkHud:update(dt)
    self.refreshT = (self.refreshT or 0) + dt
    if self.refreshT > 2000 then
        self.refreshT = 0
        self:refresh()
    end
    -- Zeiger weg (z. B. Quick Selector zu): Menü zu
    if not self:cursorShown() then
        self.options = false
        self.drag = nil
    end
    pcall(self.pollMouse, self)
end

function HubLinkHud:consoleHud(a, b, c)
    local p = self.prefs
    if a == "pos" and tonumber(b) ~= nil and tonumber(c) ~= nil then
        p.x = math.max(0, math.min(0.95, tonumber(b)))
        p.y = math.max(0.15, math.min(1, tonumber(c)))
    elseif a == "rows" and tonumber(b) ~= nil then
        p.rows = math.max(1, math.min(15, math.floor(tonumber(b))))
    elseif a == "reset" then
        p.visible, p.x, p.y, p.w, p.rows, p.scale, p.alpha = true, 0.74, 0.79, 420, 5, 1, 0.72
    elseif a == "on" or a == "off" then
        p.visible = a == "on"
    else
        p.visible = not p.visible
    end
    self:refresh()
    self:savePrefs()
    return string.format("hubHud: %s, Position %.3f %.3f, Breite %d, Zeilen %d", p.visible and "an" or "aus", p.x, p.y, p.w, p.rows)
end

function HubLinkHud:consoleDone(n)
    self:refresh()
    local i = tonumber(n)
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
