require "holdthedoor/core"
if isClient() then return end
local H = HoldTheDoor
local sessions, doors = {}, {}
H.sessions = sessions

local function reply(player, token, state)
    local args = {token = token, state = state, player = player:getPlayerNum()}
    if isServer() then sendServerCommand(player, H.module, "state", args)
    elseif H.onReply then H.onReply(args) end
end

function H.release(player, reason)
    local s = sessions[player]
    if not s then return end
    sessions[player], doors[s.door] = nil, nil
    H.restore(s.door)
    reply(player, s.token, reason or "released")
end

function H.command(player, command, args)
    if type(args) ~= "table" or type(args.token) ~= "string" or #args.token > 80 then return end
    local s = sessions[player]
    if command == "begin" then
        if s then
            reply(player, args.token, s.token == args.token and "accepted" or "rejected")
            return
        end
        local door = H.resolve(args)
        if not H.fit(player) or not H.eligible(door) or not H.adjacent(player, door)
            or H.held(door) or player:isPlayerMoving() or player:isAiming() then
            reply(player, args.token, "rejected")
            return
        end
        local multiplier = H.multiplier()
        local original = door:getHealth()
        door:getModData()[H.key] = {multiplier = multiplier, original = original}
        door:setHealth(math.floor(original * multiplier))
        s = {door = door, token = args.token, lastSeen = getTimestampMs(), square = player:getCurrentSquare()}
        sessions[player], doors[door] = s, player
        H.sync(door)
        reply(player, args.token, "accepted")
    elseif s and s.token == args.token then
        if command == "end" then
            H.release(player, H.broken(s.door) and "broken" or "released")
        elseif command == "pulse" then
            s.lastSeen = getTimestampMs()
        end
    end
end

Events.OnClientCommand.Add(function(module, command, player, args)
    if module == H.module then H.command(player, command, args) end
end)

Events.OnTick.Add(function()
    local now = getTimestampMs()
    for player, s in pairs(sessions) do
        if H.broken(s.door) then H.release(player, "broken")
        elseif not H.exists(s.door) or not H.eligible(s.door) or not H.fit(player)
            or not H.adjacent(player, s.door) or player:getCurrentSquare() ~= s.square
            or player:isPlayerMoving() or player:isAiming() or now - s.lastSeen > H.lease then
            H.release(player)
        end
    end
end)

Events.OnObjectAboutToBeRemoved.Add(function(object)
    local player = doors[object]
    if player then H.release(player, H.broken(object) and "broken" or "released") end
end)

Events.LoadGridsquare.Add(function(square)
    local objects = square:getObjects()
    for i = 0, objects:size() - 1 do
        local door = objects:get(i)
        if H.held(door) and not doors[door] then H.restore(door) end
    end
end)

-- World objects are saved after OnSave. End live sessions before serializing;
-- LoadGridsquare also repairs markers left by an interrupted save/server crash.
Events.OnSave.Add(function()
    for player in pairs(sessions) do H.release(player) end
end)
