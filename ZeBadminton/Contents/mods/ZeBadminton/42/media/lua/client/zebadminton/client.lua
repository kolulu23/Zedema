require "zebadminton/core"
require "ISUI/ISPanel"
require "ISUI/ISButton"
local B = ZeBadminton
local states, active, sequence, lane = {}, nil, 0, 0
local notice, nextList, nextPulse = "Equip a tennis racket; right-click to create/join", 0, 0
local function request(command, id, shot)
    local p = getSpecificPlayer(0)
    if not p then return end
    sequence = sequence + 1
    local a = {version = B.version, sequence = sequence, id = id, shot = shot or "clear", lane = lane}
    if isClient() then sendClientCommand(p, B.module, command, a)
    elseif B.command then B.command(p, command, a) end
end
local function accept(s)
    if type(s) ~= "table" or s.version ~= B.version or not B.finite(s.id) then return end
    local old = states[s.id]
    if old and old.revision >= s.revision then return end
    s.received = getTimestampMs() / 1000
    states[s.id] = s
    local p = getSpecificPlayer(0)
    if p and B.member(s, p:getUsername()) then
        active = s.id
    elseif active == s.id then
        active = nil
    end
end
function B.receive(command, a)
    if command == "state" then accept(a)
    elseif command == "list" and a.version == B.version then
        local present = {}
        for _, s in ipairs(a.courts) do present[s.id] = true; accept(s) end
        for id in pairs(states) do
            if not present[id] then states[id] = nil; if active == id then active = nil end end
        end
    elseif command == "left" and active == a.id then active = nil; notice = "Left court"
    elseif command == "notice" then notice = a.text end
end
Events.OnServerCommand.Add(function(module, command, a)
    if module == B.module then B.receive(command, a) end
end)
Events.OnFillWorldObjectContextMenu.Add(function(playerNum, context, objects, test)
    if test or playerNum ~= 0 then return end
    local p = getSpecificPlayer(playerNum)
    if not p then return end
    if active then
        context:addOption("Badminton: leave court", nil, function() request("leave", active) end)
        return
    end
    local item = p:getPrimaryHandItem()
    if not item or item:getFullType() ~= "Base.TennisRacket" then return end
    context:addOption("Badminton: create court north of me", nil, function() request("create") end)
    context:addOption("Badminton: refresh nearby courts", nil, function() request("list") end)
    for id, c in pairs(states) do
        if B.inside(c, {x = p:getX(), y = p:getY(), z = p:getZ()}) then
            local courtId = id
            context:addOption("Badminton: join court " .. id, nil, function() request("join", courtId) end)
        end
    end
end)
local Panel = ISPanel:derive("ZeBadmintonPanel")
function Panel:render()
    ISPanel.render(self)
    local c = states[active]
    self:drawText("BADMINTON  |  Aim: " .. ({[-1] = "left", [0] = "centre", [1] = "right"})[lane], 10, 8, 1, 1, 1, 1, UIFont.Small)
    if c then
        local p = getSpecificPlayer(0)
        local side = p and B.member(c, p:getUsername())
        self:drawText("Court " .. c.id .. "   " .. c.score[1] .. " : " .. c.score[2] .. "   " .. c.phase,
            10, 30, 1, 1, 1, 1, UIFont.Small)
        self:drawText("You: side " .. tostring(side) .. " | Serve: " .. c.server .. " | " .. c.event,
            10, 50, 0.7, 1, 0.7, 1, UIFont.Small)
    end
    self:drawText(notice, 10, 72, 1, 0.85, 0.5, 1, UIFont.Small)
end
local Overlay = ISUIElement:derive("ZeBadmintonOverlay")
local function screen(x, y, z)
    local zoom = getCore():getZoom(0)
    return IsoUtils.XToScreenExact(x, y, z, 0) / zoom, IsoUtils.YToScreenExact(x, y, z, 0) / zoom
end
function Overlay:render()
    local p = getSpecificPlayer(0)
    if not p then return end
    for _, c in pairs(states) do
        if B.inside(c, {x = p:getX(), y = p:getY(), z = p:getZ()}, 20) then
            local function line(x1, y1, x2, y2, r, g, b)
                local sx, sy = screen(x1, y1, c.z)
                local ex, ey = screen(x2, y2, c.z)
                self:drawLine2(sx, sy, ex, ey, 0.75, r, g, b)
            end
            line(c.x, c.y, c.x + 6, c.y, 0.3, 1, 0.6)
            line(c.x, c.y + 14, c.x + 6, c.y + 14, 0.3, 1, 0.6)
            line(c.x, c.y, c.x, c.y + 14, 0.3, 1, 0.6)
            line(c.x + 6, c.y, c.x + 6, c.y + 14, 0.3, 1, 0.6)
            line(c.x, c.y + 7, c.x + 6, c.y + 7, 1, 0.7, 0.2)
            if c.shuttle then
                local s = {}
                for k, v in pairs(c.shuttle) do s[k] = v end
                B.advance(s, math.max(0, math.min(getTimestampMs() / 1000 - c.received, 0.15)))
                -- PZ z is a storey, simulation h is metres (3 m / storey visual scale).
                local sx, sy = screen(s.x, s.y, c.z)
                local bx, by = screen(s.x, s.y, c.z + math.max(0, s.h) / 3)
                self:drawRect(sx - 4, sy - 2, 8, 4, 0.6, 0, 0, 0)
                self:drawRect(bx - 3, by - 3, 6, 6, 1, 1, 1, 0.7)
                self:drawLine2(sx, sy, bx, by, 0.3, 1, 1, 1)
            end
        end
    end
end
local panel
Events.OnGameStart.Add(function()
    local overlay = Overlay:new(0, 0, getCore():getScreenWidth(), getCore():getScreenHeight())
    overlay:initialise(); overlay:addToUIManager()
    panel = Panel:new(20, 180, 470, 165)
    panel:initialise(); panel:addToUIManager(); panel:setVisible(false)
    local function button(text, x, y, width, callback)
        local b = ISButton:new(x, y, width, 25, text, nil, callback)
        b:initialise(); panel:addChild(b)
    end
    button("Serve", 10, 100, 72, function() request("serve", active) end)
    button("Clear", 88, 100, 72, function() request("hit", active, "clear") end)
    button("Smash", 166, 100, 72, function() request("hit", active, "smash") end)
    button("Drop", 244, 100, 72, function() request("hit", active, "drop") end)
    button("Leave", 322, 100, 72, function() request("leave", active) end)
    button("Aim left", 10, 132, 105, function() lane = -1 end)
    button("Aim centre", 122, 132, 105, function() lane = 0 end)
    button("Aim right", 234, 132, 105, function() lane = 1 end)
end)
Events.OnTick.Add(function()
    local p = getSpecificPlayer(0)
    if not p then return end
    local t = getTimestampMs() / 1000
    local item = p:getPrimaryHandItem()
    local enabled = active ~= nil or (item and item:getFullType() == "Base.TennisRacket")
    if panel then panel:setVisible(enabled == true) end
    if enabled and t >= nextList then nextList = t + 5; request("list") end
    if active and t >= nextPulse then nextPulse = t + 2; request("pulse", active) end
end)
