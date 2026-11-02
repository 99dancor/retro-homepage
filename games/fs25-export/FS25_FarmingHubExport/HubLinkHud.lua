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
--
-- Ab 3.7: Hintergrund in der Farbe der Spiel-HUD (HUD.COLOR.BACKGROUND), Tracker (Werte ohne Aufgabe, Reiter „Tracker“ im
-- Optionsmenü, je Spieler höchstens 8) in einem eigenen Block unter den Meldungen.
--
-- Ab 3.8: Helfer-Meldungen, Regen-Warnung und Markierungen auf der Karte (je Spieler unter Anzeige → Inhalt schaltbar).

HubLinkHud = {}
HubLinkHud.FILE = "hubLinkHud.xml"
-- alpha -1 = Deckkraft wie die Spiel-HUD
HubLinkHud.prefs = { visible = true, x = 0.74, y = 0.79, w = 420, rows = 5, scale = 1, alpha = -1, details = true, notes = true, accent = 1, round = true, trackers = true, track = {}, markers = true, trackHide = {} }
HubLinkHud.markers = {}
-- 3.10.1: Kartenmarkierungen aus. Ein PlaceableHotspot ohne Gebäude legt im Spiel die Karte im Menü lahm
-- (Menü weg, nur Alt+F4). Bleibt aus, bis ein Weg ohne dieses Problem gefunden ist.
HubLinkHud.MARKERS_ON = false
HubLinkHud.MARKER_MAX = 30
HubLinkHud.catalog = {}
HubLinkHud.catalogFarm = 0
HubLinkHud.trackRows = {}
HubLinkHud.trackPage = 1
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
    bg = { 0, 0, 0, 0.8 },
    bgHover = { 0.16, 0.16, 0.16, 0.9 },
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

-- Farben der Spiel-HUD übernehmen (ab 3.7): Hintergrund der Infokästen und das Orange der aktiven Symbole
local function useGameColors()
    pcall(function()
        local bg = HUD.COLOR.BACKGROUND
        if type(bg) == "table" and type(bg[1]) == "number" then
            C.bg = { bg[1], bg[2], bg[3], bg[4] or 0.8 }
            C.bgHover = { math.min(1, bg[1] + 0.14), math.min(1, bg[2] + 0.14), math.min(1, bg[3] + 0.14), math.min(1, (bg[4] or 0.8) + 0.08) }
        end
        local act = HUD.COLOR.ACTIVE
        if type(act) == "table" and type(act[1]) == "number" then
            ACCENTS[1] = { act[1], act[2], act[3], 1 }
        end
    end)
end
HubLinkHud.useGameColors = useGameColors

-- Deckkraft: eigene Einstellung oder wie das Spiel
local function bgAlpha()
    local a = HubLinkHud.prefs.alpha
    if type(a) ~= "number" or a < 0 then
        return C.bg[4]
    end
    return a
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
    text(x + w / 2, mid(y, h, size), size, fit(label, size, w - px(8)), on and C.onAccent or (enabled and (hover and C.accent or C.text) or C.off), true, RenderText.ALIGN_CENTER)
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
    elseif k == "objects" then
        return string.format(T("hubLink_storeFull", "%s: Lager fast voll (%d %%)"), place, pct)
    elseif k == "balesReady" then
        return string.format(T("hubLink_balesReady", "Silage fertig: %d Ballen"), math.floor((e.level or 0) + 0.5))
    elseif k == "orchardHarvest" then
        return string.format(T("hubLink_orchardHarvest", "%s: %s ernten (%d %%)"), place, goodName(e), pct)
    elseif k == "orchardCut" then
        return string.format(T("hubLink_orchardCut", "%s: zurückschneiden (%d %%)"), place, pct)
    elseif k == "orchardSpray" then
        return string.format(T("hubLink_orchardSpray", "%s: Fungizid spritzen (%d %% krank)"), place, math.max(1, pct))
    elseif k == "helper" then
        return string.format(T("hubLink_helper", "%s: Helfer angehalten"), place)
    elseif k == "helperDone" then
        return string.format(T("hubLink_helperDone", "%s: Helfer fertig"), place)
    elseif k == "rain" then
        local where = e.name ~= "" and string.format(string.find(e.name, ",") and T("hubLink_fieldsMany", "Felder %s") or T("hubLink_fieldsOne", "Feld %s"), e.name) or e.sub
        if (e.hours or 0) < 0.5 then
            return string.format(T("hubLink_rainNow", "Regen: %s erntereif"), where)
        end
        return string.format(T("hubLink_rainSoon", "Regen in %s: %s erntereif"), hours(e.hours), where)
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
    local k = e.kind
    if k == "helper" or k == "helperDone" then
        return e.sub or ""
    elseif k == "rain" then
        if e.name ~= "" and e.sub ~= "" then
            table.insert(bits, e.sub)
        end
        table.insert(bits, T("hubLink_rainHint", "vorher ernten, nass geht es nicht"))
        return table.concat(bits, "  ·  ")
    end
    if k == "objects" then
        table.insert(bits, string.format(T("hubLink_pieces", "%s / %s Stück"), fmt(e.level), fmt(e.cap)))
    elseif (e.level or -1) >= 0 and (e.cap or 0) > 0 then
        table.insert(bits, string.format(T("hubLink_level", "%s / %s l"), fmt(e.level), fmt(e.cap)))
    end
    if (e.pct or -1) >= 0 and k ~= "stopped" and k ~= "orchardHarvest" and k ~= "orchardCut" and k ~= "orchardSpray" then
        table.insert(bits, string.format("%d %%", math.floor(e.pct + 0.5)))
    end
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
    elseif k == "silo" or k == "objects" then
        table.insert(bits, string.format(T("hubLink_limitFrom", "Grenze ab %s"), cfg.siloPct .. " %"))
    elseif k == "balesReady" then
        table.insert(bits, T("hubLink_balesHint", "fertig gegoren, abholen oder einlagern"))
    elseif k == "orchardHarvest" or k == "orchardCut" then
        table.insert(bits, T("hubLink_orchardHint", "Anteil der Plantage, laut Pflanzen im Spiel"))
    elseif k == "orchardSpray" then
        table.insert(bits, T("hubLink_sprayHint", "vor der letzten Wachstumsstufe spritzen"))
    elseif k == "blocked" then
        table.insert(bits, T("hubLink_blockedHint", "Palette passt nicht aus dem Ausgang"))
    elseif k == "pallets" then
        table.insert(bits, T("hubLink_palletsHint", "Palettenplatz am Stall voll"))
    elseif FIELD_KINDS[k] ~= nil then
        table.insert(bits, T("hubLink_fieldHint", "laut Feldzustand im Spiel"))
    end
    return table.concat(bits, "  ·  ")
end

-- ---------- Tracker (ab 3.7) ----------
local TRACK_GROUPS = {
    prod = { "hubLink_trProd", "Produktionen" }, stall = { "hubLink_trStall", "Ställe" }, silo = { "hubLink_trSilo", "Silos und Lager" },
    store = { "hubLink_trStore", "Ballenlager" }, bales = { "hubLink_trBales", "Ballen" }, orchard = { "hubLink_trOrchard", "Plantagen" }, field = { "hubLink_trField", "Felder" },
}
HubLinkHud.TRACK_GROUPS = TRACK_GROUPS

local function parts(s)
    local out = {}
    for part in string.gmatch(s or "", "[^;]+") do
        local f = {}
        for x in string.gmatch(part, "[^:]+") do
            table.insert(f, x)
        end
        table.insert(out, f)
    end
    return out
end

local function good(name)
    return goodName({ fill = name, fillTitle = name })
end

local function pctText(v)
    return string.format("%d %%", math.floor((tonumber(v) or 0) + 0.5))
end

function HubLinkHud:trackName(e)
    if e.kind == "field" then
        return string.format(T("hubLink_fieldsOne", "Feld %s"), e.name or "")
    elseif e.kind == "bales" then
        return T("hubLink_trBales", "Ballen")
    end
    return self:placeName(e)
end

-- Einzelwerte eines Trackers: { id, text }. Die id bleibt gleich (Ware, Futter, Bedingung), damit jeder Spieler einzelne
-- Werte ausblenden kann (ab 3.9, prefs.trackHide[Schlüssel][id])
function HubLinkHud:trackParts(e)
    local k, list = e.kind, {}
    local function add(id, t)
        table.insert(list, { id = id, text = t })
    end
    if k == "prod" then
        for _, f in ipairs(parts(e.sub)) do
            local t = good(f[2]) .. " " .. pctText(f[3])
            local h = tonumber(f[4] or "") or -1
            if f[1] == "i" and h >= 0 then
                t = t .. " (" .. hours(h) .. ")"
            end
            add((f[1] or "") .. ":" .. (f[2] or ""), t)
        end
    elseif k == "stall" then
        for _, f in ipairs(parts(e.sub)) do
            if f[1] == "a" then
                add("a", string.format(T("hubLink_trAnimals", "%s Tiere"), f[2] or "0"))
            elseif f[1] == "f" then
                add("f", T("hubLink_trFood", "Futter") .. " " .. pctText(f[2]))
            elseif f[1] == "c" then
                add("c:" .. (f[2] or ""), (f[2] or "?") .. " " .. pctText(f[3]))
            end
        end
    elseif k == "silo" then
        for _, f in ipairs(parts(e.sub)) do
            add(f[1] or "", good(f[1]) .. " " .. string.format(T("hubLink_trLiters", "%s l"), fmt(tonumber(f[2]) or 0)))
        end
    elseif k == "store" then
        for _, f in ipairs(parts(e.sub)) do
            add(f[1] or "", good(f[1]) .. " " .. (f[2] or "0"))
        end
    elseif k == "field" then
        if e.fill ~= nil and e.fill ~= "" then
            if e.sev == 1 then
                add("g", T("hubLink_trRipe", "erntereif"))
            elseif (e.level or -1) >= 0 and (e.cap or -1) > 0 then
                add("g", string.format(T("hubLink_trStage", "Stufe %d / %d"), e.level, e.cap))
            end
        else
            add("g", T("hubLink_trNoCrop", "nichts angebaut"))
        end
    elseif k == "orchard" then
        local v = {}
        for _, f in ipairs(parts(e.sub)) do
            v[f[1]] = { tonumber(f[2]) or -1, tonumber(f[3] or "") or -1 }
        end
        add("r", T("hubLink_trRipe", "erntereif") .. " " .. pctText(v.r and v.r[1] or 0))
        if v.w ~= nil and v.w[1] > 0 then
            add("w", T("hubLink_trCut", "zurückschneiden") .. " " .. pctText(v.w[1]))
        end
        if v.s ~= nil and v.s[1] >= 0 then
            add("s", T("hubLink_trSick", "krank") .. " " .. pctText(v.s[1]))
        end
        if v.g ~= nil and v.g[1] >= 0 and v.g[2] > 0 then
            add("g", string.format(T("hubLink_trStage", "Stufe %d / %d"), v.g[1], v.g[2]))
        end
    elseif k == "bales" then
        for _, f in ipairs(parts(e.sub)) do
            local t = good(f[1]) .. " " .. (f[2] or "0")
            local ferm = tonumber(f[3] or "") or 0
            if ferm > 0 then
                t = t .. " (" .. string.format(T("hubLink_trFerment", "%d gären, %s"), ferm, pctText(f[4])) .. ")"
            end
            add(f[1] or "", t)
        end
    end
    return list
end

function HubLinkHud:trackHidden(key, id)
    local h = (self.prefs.trackHide or {})[key]
    return h ~= nil and h[id] == true
end

function HubLinkHud:toggleTrackPart(key, id)
    local all = self.prefs.trackHide or {}
    local h = all[key] or {}
    h[id] = not h[id] or nil
    all[key] = next(h) ~= nil and h or nil
    self.prefs.trackHide = all
    self:refresh()
    self:savePrefs()
end

-- Wert rechts in der ersten Zeile und die Einzelheiten darunter (ohne ausgeblendete)
function HubLinkHud:trackValue(e)
    local k, right, bits = e.kind, "", {}
    for _, part in ipairs(self:trackParts(e)) do
        if not self:trackHidden(e.key, part.id) then
            table.insert(bits, part.text)
        end
    end
    if (k == "prod" or k == "stall" or k == "silo") and (e.pct or -1) >= 0 then
        right = pctText(e.pct)
    elseif k == "store" then
        right = string.format("%s / %s", fmt(e.level), fmt(e.cap))
    elseif k == "field" then
        right = (e.fill ~= nil and e.fill ~= "") and goodName(e) or ""
    elseif k == "orchard" then
        right = goodName(e)
    elseif k == "bales" then
        right = fmt(e.level)
    end
    return right, table.concat(bits, "  ·  ")
end

function HubLinkHud:trackSet()
    local set = {}
    for _, k in ipairs(self.prefs.track or {}) do
        set[k] = true
    end
    return set
end

function HubLinkHud:toggleTrack(key)
    local list, found = {}, false
    for _, k in ipairs(self.prefs.track) do
        if k == key then
            found = true
        else
            table.insert(list, k)
        end
    end
    if not found then
        if #list >= (FarmingHubLive.TRACK_MAX or 8) then
            return
        end
        table.insert(list, key)
    end
    self.prefs.track = list
    self.trackDirty = true
    self:refresh()
    self:savePrefs()
end

-- Auswahl an den Server; mit Katalog, solange der Reiter offen ist
function HubLinkHud:sendTrack(wantCatalog)
    local farm = HubLinkHud.myFarm ~= nil and HubLinkHud.myFarm() or 0
    self.trackSent = g_time
    self.trackFarm = farm
    if wantCatalog then
        self.catalogAsk = g_time
    end
    pcall(HubLinkTrackEvent.send, self.prefs.track, farm, wantCatalog)
end

function HubLinkHud:onCatalog(list, farm)
    self.catalog = list or {}
    self.catalogFarm = farm or 0
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

-- Name des Hofs aus dem Spiel, sonst „Hof n“ (ab 3.9)
function HubLinkHud:farmName(id)
    local name = nil
    pcall(function()
        local f = g_farmManager:getFarmById(id)
        name = f ~= nil and (f.name or (f.getName ~= nil and f:getName())) or nil
    end)
    if type(name) ~= "string" or name == "" then
        return string.format(T("hubLink_tabFarm", "Hof %d"), id)
    end
    return name
end

-- Logo, das man beim Anlegen des Hofs wählt. Wo das Spiel es führt, ist nicht dokumentiert; die Mod probiert die
-- naheliegenden Namen und merkt sich das Bild je Hof. Ohne Treffer: kein Logo (die Live-Datei verrät die Felder des Hofs).
local function logoFile(f)
    for _, k in ipairs({ "iconFilename", "logoFilename", "imageFilename", "iconFile", "logo" }) do
        if type(f[k]) == "string" and f[k] ~= "" then
            return f[k], nil
        end
    end
    for _, k in ipairs({ "getIconFilename", "getLogoFilename", "getIcon", "getLogo" }) do
        if type(f[k]) == "function" then
            local ok, a, b = pcall(f[k], f)
            if ok and type(a) == "string" and a ~= "" then
                return a, type(b) == "table" and b or nil
            end
            if ok and type(a) == "table" and type(a.filename) == "string" then
                return a.filename, a.uvs
            end
        end
    end
    local idx = f.icon or f.iconIndex or f.logoIndex
    if type(idx) == "number" then
        for _, list in ipairs({ Farm ~= nil and Farm.ICONS, Farm ~= nil and Farm.LOGOS, g_farmManager ~= nil and g_farmManager.icons }) do
            local e = type(list) == "table" and list[idx] or nil
            if type(e) == "string" then
                return e, nil
            elseif type(e) == "table" and type(e.filename) == "string" then
                return e.filename, e.uvs
            end
        end
    end
    return nil, nil
end

-- Hoffarbe (ab 3.10): FS25 speichert beim Hof nur Name und Farbe (farm.color), kein eigenes Bild.
-- Das Hofsymbol im Spiel ist ein Hof in dieser Farbe, also zeichnen wir genau das.
local function colorOf(c)
    if type(c) ~= "table" then
        return nil
    end
    local r, g, b = c[1] or c.r, c[2] or c.g, c[3] or c.b
    if type(r) == "number" and type(g) == "number" and type(b) == "number" then
        return { r, g, b, 1 }
    end
    return nil
end
function HubLinkHud:farmColor(id)
    local col = nil
    pcall(function()
        local f = g_farmManager:getFarmById(id)
        if f == nil then
            return
        end
        if type(f.getColor) == "function" then
            col = colorOf({ f:getColor() }) or colorOf(f:getColor())
        end
        if col == nil and type(f.color) == "number" and Farm ~= nil and type(Farm.COLORS) == "table" then
            col = colorOf(Farm.COLORS[f.color])
        end
        if col == nil and type(f.color) == "table" then
            col = colorOf(f.color)
        end
    end)
    return col
end

-- kleiner Hof aus Rechtecken: Dach in Stufen, Wand, dunkles Tor
function HubLinkHud:drawFarmIcon(x, y, h, col)
    local w = h * g_screenHeight / g_screenWidth
    local dark = { col[1] * 0.45, col[2] * 0.45, col[3] * 0.45, 1 }
    local wallH = h * 0.5
    drawFilledRect(x + w * 0.1, y, w * 0.8, wallH, col[1], col[2], col[3], 1)
    local steps = 4
    for i = 0, steps - 1 do
        local sw = w * (1 - i / steps)
        local sh = (h - wallH) / steps
        drawFilledRect(x + (w - sw) / 2, y + wallH + i * sh, sw, sh, dark[1], dark[2], dark[3], 1)
    end
    drawFilledRect(x + w * 0.38, y, w * 0.24, wallH * 0.62, dark[1], dark[2], dark[3], 1)
    return w
end

HubLinkHud.logos = {}
function HubLinkHud:farmLogo(id)
    if id == nil or id < 1 or createImageOverlay == nil then
        return nil
    end
    local c = self.logos[id]
    if c == nil then
        c = { id = false }
        pcall(function()
            local f = g_farmManager:getFarmById(id)
            local file, uvs = logoFile(f or {})
            if file ~= nil then
                local o = createImageOverlay(file)
                if o ~= nil and o ~= 0 then
                    if uvs ~= nil and setOverlayUVs ~= nil then
                        setOverlayUVs(o, unpack(uvs))
                    end
                    c.id = o
                end
            end
        end)
        self.logos[id] = c
    end
    return c.id or nil
end

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
            if e.src ~= 4 and (wait == nil or g_time - wait > 15000) and (e.farm == farm or e.farm == 0) then
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
    -- Tracker in der Reihenfolge der Auswahl
    local byKey, track = {}, {}
    for _, e in ipairs(FarmingHubLive ~= nil and FarmingHubLive.viewList or {}) do
        if e.src == 4 and e.farm == farm then
            byKey[e.key] = e
        end
    end
    if farm > 0 and self.prefs.trackers then
        for _, k in ipairs(self.prefs.track or {}) do
            if byKey[k] ~= nil then
                table.insert(track, byKey[k])
            end
        end
    end
    self.trackRows = track
    pcall(self.updateMarkers, self, rows)
end

-- ---------- Kartenmarkierungen (ab 3.8) ----------
local function markerType()
    if PlaceableHotspot == nil or PlaceableHotspot.TYPE == nil then
        return nil
    end
    for _, n in ipairs({ "EXCLAMATION_MARK", "UNLOADING" }) do
        if PlaceableHotspot.TYPE[n] ~= nil then
            return PlaceableHotspot.TYPE[n]
        end
    end
    return nil
end

function HubLinkHud:removeMarker(key)
    local m = self.markers[key]
    if m ~= nil then
        pcall(function()
            g_currentMission:removeMapHotspot(m.hotspot)
        end)
        pcall(function()
            m.hotspot:delete()
        end)
        self.markers[key] = nil
    end
end

function HubLinkHud:clearMarkers()
    for key in pairs(self.markers) do
        self:removeMarker(key)
    end
end

-- Markierungen passend zur Liste: neue anlegen, verschwundene weg, Namen nachziehen
function HubLinkHud:updateMarkers(rows)
    local want, n = {}, 0
    if HubLinkHud.MARKERS_ON and self.prefs.markers and not self.markerFail and g_currentMission ~= nil and g_dedicatedServer == nil then
        for _, e in ipairs(rows or {}) do
            if e.src == 1 and type(e.x) == "number" and type(e.z) == "number" and n < HubLinkHud.MARKER_MAX then
                want[e.key] = e
                n = n + 1
            end
        end
    end
    for key, m in pairs(self.markers) do
        local e = want[key]
        if e == nil or math.abs(m.x - e.x) > 1 or math.abs(m.z - e.z) > 1 then
            self:removeMarker(key)
        end
    end
    local typ = n > 0 and markerType() or nil
    for key, e in pairs(want) do
        local name = "Hub: " .. tostring(self:textOf(e) or "")
        local m = self.markers[key]
        if m == nil and typ ~= nil then
            local ok, err = pcall(function()
                local h = PlaceableHotspot.new()
                h:setPlaceableType(typ)
                h:setWorldPosition(e.x, e.z)
                h:setName(name)
                if h.setOwnerFarmId ~= nil then
                    h:setOwnerFarmId(e.farm)
                end
                g_currentMission:addMapHotspot(h)
                self.markers[key] = { hotspot = h, x = e.x, z = e.z, name = name }
            end)
            if not ok then
                self.markerFail = true
                print("Hub Link: Kartenmarkierung geht nicht: " .. tostring(err))
                self:clearMarkers()
                return
            end
        elseif m ~= nil and m.name ~= name then
            pcall(function()
                m.hotspot:setName(name)
            end)
            m.name = name
        end
    end
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
    -- vor 3.7 gespeicherte Deckkraft (hellgrau, 72 %) nicht übernehmen: ab jetzt wie die Spiel-HUD
    local v = xml:getInt(r .. "#v") or 1
    local a = xml:getFloat(r .. "#alpha")
    if v >= 2 and type(a) == "number" and a >= 0 then
        p.alpha = clamp(a, 0.3, 0.95, -1)
    else
        p.alpha = -1
    end
    p.trackHide = {}
    local hi = 0
    while xml:hasProperty(string.format("%s.hide(%d)", r, hi)) do
        local key = xml:getString(string.format("%s.hide(%d)#key", r, hi))
        local id = xml:getString(string.format("%s.hide(%d)#part", r, hi))
        if key ~= nil and id ~= nil then
            p.trackHide[key] = p.trackHide[key] or {}
            p.trackHide[key][id] = true
        end
        hi = hi + 1
    end
    local mk = xml:getBool(r .. "#markers")
    if mk ~= nil then
        p.markers = mk
    end
    local tr = xml:getBool(r .. "#trackers")
    if tr ~= nil then
        p.trackers = tr
    end
    p.track = {}
    local ti = 0
    while xml:hasProperty(string.format("%s.track(%d)", r, ti)) do
        local key = xml:getString(string.format("%s.track(%d)#key", r, ti))
        if key ~= nil and #p.track < 8 then
            table.insert(p.track, key)
        end
        ti = ti + 1
    end
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
    xml:setInt(r .. "#v", 2)
    xml:setFloat(r .. "#alpha", p.alpha)
    xml:setBool(r .. "#trackers", p.trackers)
    xml:setBool(r .. "#markers", p.markers)
    local hi = 0
    for key, h in pairs(p.trackHide or {}) do
        for id in pairs(h) do
            xml:setString(string.format("%s.hide(%d)#key", r, hi), key)
            xml:setString(string.format("%s.hide(%d)#part", r, hi), id)
            hi = hi + 1
        end
    end
    for i, key in ipairs(p.track or {}) do
        xml:setString(string.format("%s.track(%d)#key", r, i - 1), key)
    end
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
    local track = self.trackRows or {}
    if #rows == 0 and #track == 0 and not mouse and not flash and not self.options then
        return
    end
    if not self.colorsDone then
        self.colorsDone = true
        useGameColors()
        useAccent(p.accent)
    end
    local alpha = bgAlpha()
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
    -- Hof-Logo statt Strich (ab 3.9); ohne Logo kein Strich, der Name steht bündig mit den Zeilen
    local logo = self:farmLogo(farm)
    local titleX = x + pad + px(4)
    local lh = headH * 0.56
    if logo ~= nil then
        local lw = lh * g_screenHeight / g_screenWidth
        pcall(renderOverlay, logo, x + px(8), y + (headH - lh) / 2, lw, lh)
        titleX = x + px(8) + lw + px(8)
    else
        -- kein Bild im Spiel: Hofsymbol in der Hoffarbe (nie zusätzlich ein Strich)
        local col = farm ~= nil and farm >= 1 and drawFilledRect ~= nil and self:farmColor(farm) or nil
        if col ~= nil then
            local lw = self:drawFarmIcon(x + px(8), y + (headH - lh) / 2, lh, col)
            titleX = x + px(8) + lw + px(8)
        end
    end
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
    local title = upper(string.format(T("hubLink_headName", "Hub Link · %s"), self:farmName(farm)))
    text(titleX, mid(y, headH, size), size, fit(title, size, titleRight - titleX), C.text, true)
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
    if #rows == 0 and #track == 0 then
        y = y - gap - py(30)
        box(x, y, w, py(30), C.bg, alpha)
        text(x + pad + px(4), mid(y, py(30), size), size, T("hubLink_allOk", "Alles in Ordnung"), C.dim, false)
        bottom = y
    end
    -- Tracker (ab 3.7): nur Werte, kein Abhaken
    for _, e in ipairs(track) do
        y = y - gap - rowH
        box(x, y, w, rowH, C.bg, alpha)
        box(x + px(6), y + rowH * 0.2, px(4), rowH * 0.6, C.dim, nil, 2)
        local tx = x + pad + px(4)
        local right = x + w - pad
        local value, detail = "", ""
        local ok = pcall(function()
            value, detail = self:trackValue(e)
        end)
        if not ok then
            value, detail = "", ""
        end
        local name = self:trackName(e)
        local vw = value ~= "" and math.min(getTextWidth(size, value) + px(10), (right - tx) * 0.45) or 0
        if value ~= "" then
            text(right, p.details and (y + rowH * 0.52 + size * 0.05) or mid(y, rowH, size), size, fit(value, size, vw), C.accent, true, RenderText.ALIGN_RIGHT)
        end
        if p.details then
            text(tx, y + rowH * 0.52 + size * 0.05, size, fit(name, size, right - tx - vw), C.text, false)
            if detail ~= "" then
                text(tx, y + rowH * 0.14, small, fit(detail, small, right - tx), C.dim, false)
            end
        else
            text(tx, mid(y, rowH, size), size, fit(name, size, right - tx - vw), C.text, false)
        end
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
        table.insert(tabs, { "farm", T("hubLink_tabValues", "Werte") })
        table.insert(tabs, { "more", T("hubLink_tabMore", "Mehr") })
        table.insert(tabs, { "track", T("hubLink_tabTrack", "Tracker") })
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
    local function toggle(label, on, fn, enabled, extra)
        table.insert(cur.lines, { label = label, toggle = on, fn = fn, enabled = enabled, extra = extra })
    end
    local function action(label, btn, fn)
        table.insert(cur.lines, { label = label, action = btn, fn = fn, enabled = true })
    end
    local function stepper(label, value, minus, plus, enabled)
        table.insert(cur.lines, { label = label, value = value, minus = minus, plus = plus, enabled = enabled })
    end
    local function colors()
        table.insert(cur.lines, { colors = true })
    end
    local function note(label)
        table.insert(cur.lines, { note = label })
    end

    if tab == "view" then
        group(T("hubLink_grpWindow", "Fenster"))
        stepper(T("hubLink_optRows", "Zeilen"), tostring(p.rows), function() self:stepPref("rows", -1, 1, 15) end, function() self:stepPref("rows", 1, 1, 15) end, true)
        stepper(T("hubLink_optScale", "Schriftgröße"), string.format("%d %%", math.floor(p.scale * 100 + 0.5)), function() self:stepPref("scale", -0.1, 0.7, 1.5) end, function() self:stepPref("scale", 0.1, 0.7, 1.5) end, true)
        local game = p.alpha < 0
        toggle(T("hubLink_optAlphaGame", "Deckkraft wie Spiel"), game, function()
            self:setPref("alpha", game and math.floor(C.bg[4] * 10 + 0.5) / 10 or -1)
        end, true)
        stepper(T("hubLink_optAlpha", "Deckkraft"), string.format("%d %%", math.floor(bgAlpha() * 100 + 0.5)), function() self:stepPref("alpha", -0.1, 0.3, 0.95) end, function() self:stepPref("alpha", 0.1, 0.3, 0.95) end, not game)
        toggle(T("hubLink_optRound", "Runde Ecken"), p.round, function() self:setPref("round", not p.round) end, true)
        group(T("hubLink_grpColor", "Hervorhebung"))
        colors()
        group(T("hubLink_grpContent", "Inhalt"))
        toggle(T("hubLink_optDetails", "Werte anzeigen"), p.details, function() self:setPref("details", not p.details) end, true)
        toggle(T("hubLink_optNotes", "Notizen anzeigen"), p.notes, function() self:setPref("notes", not p.notes) end, true)
        if HubLinkHud.MARKERS_ON then
            toggle(T("hubLink_optMarkers", "Markierungen auf der Karte"), p.markers, function() self:setPref("markers", not p.markers) end, true)
        end
    elseif tab == "farm" or tab == "more" then
        local function ft(label, key)
            toggle(label, cfg[key], function() self:setFarm(farm, key, not cfg[key]) end, canFarm)
        end
        local function fs(label, key, unit)
            stepper(label, string.format("%s %s", tostring(math.floor((cfg[key] or 0) + 0.5)), unit), function() self:stepFarm(farm, key, -1) end, function() self:stepFarm(farm, key, 1) end, canFarm and cfg[key] ~= nil)
        end
        if tab == "farm" then
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
        else
            group(T("hubLink_grpMore", "Weitere Prüfungen"))
            ft(T("hubLink_optSilo", "Silos"), "silo")
            fs(T("hubLink_optSiloPct", "voll ab"), "siloPct", "%")
            ft(T("hubLink_optFieldsShort", "Felder (ernten, kalken, pflügen …)"), "fields")
            ft(T("hubLink_optOrchard", "Plantagen (ernten, schneiden, Fungizid)"), "orchard")
            ft(T("hubLink_optBales", "Silage fertig gegoren"), "bales")
            ft(T("hubLink_optHelper", "Helfer angehalten oder fertig"), "helper")
            ft(T("hubLink_optRain", "Regen bei reifen Feldern"), "rain")
        end
    elseif tab == "track" and self.trackEdit ~= nil then
        -- Werte eines Trackers einzeln an- und abwählen (ab 3.9)
        local key, e = self.trackEdit, nil
        for _, v in ipairs(FarmingHubLive.viewList or {}) do
            if v.src == 4 and v.key == key then
                e = v
            end
        end
        group(e ~= nil and string.format(T("hubLink_trValuesOf", "Werte: %s"), self:trackName(e)) or T("hubLink_trValues", "Werte"))
        action(T("hubLink_trBackHint", "Zur Liste der Tracker"), upper(T("hubLink_back", "Zurück")), function() self.trackEdit = nil end)
        if e == nil then
            note(T("hubLink_trLoading", "Liste kommt vom Server …"))
        else
            local list = self:trackParts(e)
            if #list == 0 then
                note(T("hubLink_trNoParts", "Dieser Tracker hat keine einzelnen Werte."))
            end
            for i, part in ipairs(list) do
                if i <= 12 then
                    toggle(part.text, not self:trackHidden(key, part.id), function() self:toggleTrackPart(key, part.id) end, true)
                end
            end
        end
    elseif tab == "track" then
        if self.catalogAsk == nil or g_time - self.catalogAsk > 10000 then
            self:sendTrack(true)
        end
        local cat = self.catalogFarm == farm and self.catalog or {}
        local sel = self:trackSet()
        local max = FarmingHubLive.TRACK_MAX or 8
        local per = 9
        local pages = math.max(1, math.ceil(#cat / per))
        self.trackPage = math.max(1, math.min(pages, self.trackPage or 1))
        group(string.format(T("hubLink_trChosen", "Ausgewählt: %d von %d"), #p.track, max))
        toggle(T("hubLink_trShow", "Tracker im Overlay zeigen"), p.trackers, function() self:setPref("trackers", not p.trackers) end, true)
        if #cat == 0 then
            note(T("hubLink_trLoading", "Liste kommt vom Server …"))
        end
        local kind = nil
        for i = (self.trackPage - 1) * per + 1, math.min(#cat, self.trackPage * per) do
            local c = cat[i]
            if c.kind ~= kind then
                kind = c.kind
                local g = TRACK_GROUPS[kind] or { "", kind }
                group(T(g[1], g[2]))
            end
            local on = sel[c.key] == true
            local extra = on and { upper(T("hubLink_trEdit", "Werte")), function() self.trackEdit = c.key end } or nil
            toggle(self:trackName(c), on, function() self:toggleTrack(c.key) end, on or #p.track < max, extra)
        end
        -- Seitenwahl ganz unten: man liest von oben nach unten und blättert dann weiter
        if pages > 1 then
            group(T("hubLink_trPages", "Weitere Tracker"))
            stepper(T("hubLink_trPage", "Seite"), string.format("%d / %d", self.trackPage, pages), function() self.trackPage = math.max(1, self.trackPage - 1) end,
                function() self.trackPage = math.min(pages, self.trackPage + 1) end, true)
        end
    else
        group(T("hubLink_optServer", "Server (Admin)"))
        toggle(T("hubLink_optAdvisor", "Produktionsberater"), s.advisor ~= false, function() self:setFarm(0, "advisor", not (s.advisor ~= false)) end, canGlobal)
        toggle(T("hubLink_optExport", "Export beim Speichern"), s.export ~= false, function() self:setFarm(0, "export", not (s.export ~= false)) end, canGlobal)
    end
    local hint
    if tab == "view" then
        hint = T("hubLink_hintView", "Gilt nur für dich, auf diesem Rechner.")
    elseif tab == "track" then
        hint = T("hubLink_hintTrack", "Nur für dich. Tracker zeigen Werte und werden nie zur Aufgabe.")
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
    -- nicht unten aus dem Bild laufen
    local top = math.min(0.995, math.max(oy, total + 0.01))
    box(x, top - total, w, total, C.bg, math.max(bgAlpha(), 0.88))

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
            self.trackEdit = nil
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
            if l.note ~= nil then
                text(lx, mid(gy, lineH, small), small, fit(l.note, small, right - lx), C.dim, false)
            elseif l.colors then
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
                local room = l.action ~= nil and px(110) or l.toggle ~= nil and (l.extra ~= nil and px(144) or px(72)) or px(150)
                text(lx, mid(gy, lineH, size), size, fit(l.label, size, right - lx - room), enabled and C.text or C.off, false)
                if l.action ~= nil then
                    local bw = px(100)
                    self:button(right - bw, by, bw, lbh, l.action, l.fn, false, true)
                elseif l.toggle ~= nil then
                    local bw = px(62)
                    self:button(right - bw, by, bw, lbh, l.toggle and upper(T("hubLink_on", "An")) or upper(T("hubLink_off", "Aus")), l.fn, l.toggle, enabled)
                    if l.extra ~= nil then
                        self:button(right - bw - px(72), by, px(66), lbh, l.extra[1], l.extra[2], false, true)
                    end
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
    useGameColors()
    useAccent(self.prefs.accent)
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
    self.catalog = {}
    self.trackRows = {}
    self.trackSent = nil
    self.colorsDone = false
    pcall(self.clearMarkers, self)
    self.markers = {}
    self.markerFail = nil
    for _, c in pairs(self.logos) do
        if c.id and delete ~= nil then
            pcall(delete, c.id)
        end
    end
    self.logos = {}
end

function HubLinkHud:update(dt)
    self.refreshT = (self.refreshT or 0) + dt
    if self.refreshT > 2000 then
        self.refreshT = 0
        self:refresh()
        -- Tracker-Auswahl: nach Änderung, Hofwechsel und alle 5 Minuten (der Server vergisst sie nach 30)
        local farm = myFarm()
        if g_dedicatedServer == nil and farm > 0 and (self.trackDirty or self.trackFarm ~= farm or self.trackSent == nil or g_time - self.trackSent > 300000) then
            self.trackDirty = false
            self:sendTrack(false)
        end
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
        p.visible, p.x, p.y, p.w, p.rows, p.scale, p.alpha = true, 0.74, 0.79, 420, 5, 1, -1
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
