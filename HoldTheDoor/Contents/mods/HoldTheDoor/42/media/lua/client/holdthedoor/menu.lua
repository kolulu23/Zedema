require "holdthedoor/action"
require "holdthedoor/guards"
require "ISUI/ISWorldObjectContextMenu"
require "TimedActions/WalkToTimedAction"
local H = HoldTheDoor

local function hold(player, door)
    if H.actions[player] or not H.eligible(door) or H.held(door) then return end
    if not H.adjacent(player, door) then
        local s = door:getSquare()
        local x, y = s:getX(), s:getY()
        if door:getNorth() then
            if player:getY() < y then y = y - 1 end
        elseif player:getX() < x then x = x - 1 end
        local target = getCell():getGridSquare(x, y, s:getZ())
        if not target or not target:canStand() then return end
        ISTimedActionQueue.add(ISWalkToTimedAction:new(player, target))
    end
    ISTimedActionQueue.add(ISHoldTheDoor:new(player, door))
end

local function release(player)
    if H.actions[player] then ISTimedActionQueue.clear(player) end
end

-- Guard callbacks before vanilla can cancel/retrigger the current timed action.
local open = ISWorldObjectContextMenu.onOpenCloseDoor
ISWorldObjectContextMenu.onOpenCloseDoor = function(objects, door, playerNum)
    if H.blocked(getSpecificPlayer(playerNum), door) then return end
    return open(objects, door, playerNum)
end
for _, name in ipairs({"onLockDoor", "onUnLockDoor"}) do
    local original = ISWorldObjectContextMenu[name]
    ISWorldObjectContextMenu[name] = function(objects, playerNum, door, ...)
        if H.blocked(getSpecificPlayer(playerNum), door) then return end
        return original(objects, playerNum, door, ...)
    end
end

Events.OnFillWorldObjectContextMenu.Add(function(playerNum, context, objects, test)
    local player = getSpecificPlayer(playerNum)
    if not player then return end
    if H.actions[player] then
        if test then return ISWorldObjectContextMenu.setTest() end
        context:addOption(getText("ContextMenu_HoldTheDoor_Release"), player, release)
        return
    end
    if not H.fit(player) then return end
    local seen = {}
    for _, door in ipairs(objects) do
        if H.eligible(door) and not seen[door] then
            seen[door] = true
            if test then return ISWorldObjectContextMenu.setTest() end
            local option = context:addOption(getText("ContextMenu_HoldTheDoor_HoldIt"), player, hold, door)
            option.notAvailable = H.held(door)
        end
    end
end)
