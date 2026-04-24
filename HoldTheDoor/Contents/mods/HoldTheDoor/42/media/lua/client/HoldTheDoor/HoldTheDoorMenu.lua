local HoldTheDoor = require("HoldTheDoor/HoldTheDoorShared")
local HoldTheDoorAction = require("HoldTheDoor/HoldTheDoorAction")

local HoldTheDoorMenu = {}

---------------------------------------------------------------------------
-- Find the first door object in a list of world objects.
---@param worldobjects IsoObject[]
---@return IsoDoor|IsoThumpable|nil
---------------------------------------------------------------------------
local function findDoor(worldobjects)
    for i = 1, #worldobjects do
        local obj = worldobjects[i]
        if HoldTheDoor.isDoorValid(obj) then
            ---@cast obj IsoDoor|IsoThumpable
            return obj
        end
    end
    -- Also check objects on the same square (doors may not be the top-level click target)
    for i = 1, #worldobjects do
        local sq = worldobjects[i]:getSquare()
        if sq then
            for j = 0, sq:getObjects():size() - 1 do
                local obj = sq:getObjects():get(j)
                if HoldTheDoor.isDoorValid(obj) then
                    ---@cast obj IsoDoor|IsoThumpable
                    return obj
                end
            end
        end
    end
    return nil
end

---------------------------------------------------------------------------
-- Callback when "Hold It" is selected from the context menu.
---@param player IsoPlayer
---@param door IsoDoor|IsoThumpable
---------------------------------------------------------------------------
local function onHoldDoor(player, door)
    if not HoldTheDoor.canHoldDoor(player, door) then return end

    ISTimedActionQueue.add(HoldTheDoorAction:new(player, door))
end

---------------------------------------------------------------------------
-- Context menu hook
---@param playerIndex number
---@param context ISContextMenu
---@param worldobjects IsoObject[]
---@param test boolean|nil
---------------------------------------------------------------------------
function HoldTheDoorMenu.OnFillWorldObjectContextMenu(playerIndex, context, worldobjects, test)
    if test then return end

    local door = findDoor(worldobjects)
    if door == nil then return end

    local player = getSpecificPlayer(playerIndex)
    if player == nil then return end

    -- If the door is currently held, disable vanilla "Open" / "Unlock" for everyone
    if HoldTheDoor.isDoorHeld(door) then
        local holderID = HoldTheDoor.getHolderID(door)
        local isHolder = (holderID == player:getOnlineID())

        -- Disable open/unlock options for non-holders
        if not isHolder then
            ---@diagnostic disable-next-line: undefined-field
            local options = context:getOptions()
            if options then
                for i = 0, options:size() - 1 do
                    local opt = options:get(i)
                    local name = opt:getName()
                    if name then
                        -- Match vanilla door options by their translated names
                        if name == getText("ContextMenu_Open_door")
                            or name == getText("ContextMenu_Close_door")
                            or name == getText("ContextMenu_Unlock_door") then
                            opt.notAvailable = true
                            local tooltip = ISWorldObjectContextMenu.addToolTip()
                            tooltip.description = getText("ContextMenu_HoldTheDoor_DoorHeld")
                            opt.toolTip = tooltip
                        end
                    end
                end
            end
        end
        return
    end

    -- Eligibility check
    local canHold, reason = HoldTheDoor.canHoldDoor(player, door)
    if not canHold then
        if reason then
            -- Show a greyed-out option with tooltip explaining why
            local option = context:addOption(getText("ContextMenu_HoldTheDoor_HoldIt"), player, nil)
            option.notAvailable = true
            local tooltip = ISWorldObjectContextMenu.addToolTip()
            tooltip.description = getText(reason)
            option.toolTip = tooltip
        end
        return
    end

    context:addOption(getText("ContextMenu_HoldTheDoor_HoldIt"), player, onHoldDoor, door)
end

Events.OnFillWorldObjectContextMenu.Add(HoldTheDoorMenu.OnFillWorldObjectContextMenu)

return HoldTheDoorMenu
