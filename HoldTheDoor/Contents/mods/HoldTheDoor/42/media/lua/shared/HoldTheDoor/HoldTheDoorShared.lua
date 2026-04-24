---@class HoldTheDoorShared
local HoldTheDoor = {}

---------------------------------------------------------------------------
-- ModData key constants (avoid string typos across files)
---------------------------------------------------------------------------
HoldTheDoor.MOD_ID = "HoldTheDoor"

HoldTheDoor.Keys = {
    IS_HELD           = "holdTheDoor_isHeld",
    PLAYER_ID         = "holdTheDoor_playerID",
    ORIGINAL_HEALTH   = "holdTheDoor_originalHealth",
    ORIGINAL_MAX_HP   = "holdTheDoor_originalMaxHealth",
    PLAYER_HOLDING    = "holdTheDoor_heldDoor",
}

---------------------------------------------------------------------------
-- Utilities
---------------------------------------------------------------------------

--- Check if an IsoObject is a door (IsoDoor or IsoThumpable acting as door).
---@param object IsoObject|nil
---@return boolean
function HoldTheDoor.isDoorValid(object)
    if object == nil then return false end
    if instanceof(object, "IsoDoor") then return true end
    if instanceof(object, "IsoThumpable") then
        ---@cast object IsoThumpable
        return object:isDoor()
    end
    return false
end

--- Check if a door is currently being held by any player.
---@param door IsoDoor|IsoThumpable
---@return boolean
function HoldTheDoor.isDoorHeld(door)
    if door == nil then return false end
    if not door:hasModData() then return false end
    return door:getModData()[HoldTheDoor.Keys.IS_HELD] == true
end

--- Get the online ID of the player holding this door, or nil.
---@param door IsoDoor|IsoThumpable
---@return number|nil
function HoldTheDoor.getHolderID(door)
    if not HoldTheDoor.isDoorHeld(door) then return nil end
    return door:getModData()[HoldTheDoor.Keys.PLAYER_ID]
end

--- Check whether a player is currently holding any door.
---@param player IsoPlayer
---@return boolean
function HoldTheDoor.isPlayerHolding(player)
    if player == nil then return false end
    if not player:hasModData() then return false end
    return player:getModData()[HoldTheDoor.Keys.PLAYER_HOLDING] == true
end

--- Full eligibility check: can this player hold this door right now?
---@param player IsoPlayer
---@param door IsoDoor|IsoThumpable
---@return boolean canHold
---@return string|nil reason  -- reason key if cannot hold (for UI tooltip)
function HoldTheDoor.canHoldDoor(player, door)
    if player == nil or door == nil then
        return false, nil
    end

    if not HoldTheDoor.isDoorValid(door) then
        return false, nil
    end

    -- Door must be closed
    if door:IsOpen() then
        return false, nil
    end

    -- Door must not be barricaded
    if door:isBarricaded() then
        return false, nil
    end

    -- Door must have health remaining
    if door:getHealth() <= 0 then
        return false, nil
    end

    -- Player must not already be holding a door
    if HoldTheDoor.isPlayerHolding(player) then
        return false, nil
    end

    -- Door must not already be held by another player
    if HoldTheDoor.isDoorHeld(door) then
        return false, "ContextMenu_HoldTheDoor_DoorHeld"
    end

    return true, nil
end

--- Get the configured HP multiplier from sandbox options.
---@return number
function HoldTheDoor.getHPMultiplier()
    if SandboxVars and SandboxVars.HoldTheDoor and SandboxVars.HoldTheDoor.HPMultiplier then
        return SandboxVars.HoldTheDoor.HPMultiplier
    end
    return 3.0
end

--- Clear all HoldTheDoor ModData from a door object.
---@param door IsoDoor|IsoThumpable
function HoldTheDoor.clearDoorModData(door)
    if door == nil or not door:hasModData() then return end
    local md = door:getModData()
    md[HoldTheDoor.Keys.IS_HELD] = nil
    md[HoldTheDoor.Keys.PLAYER_ID] = nil
    md[HoldTheDoor.Keys.ORIGINAL_HEALTH] = nil
    md[HoldTheDoor.Keys.ORIGINAL_MAX_HP] = nil
end

--- Clear HoldTheDoor ModData from a player.
---@param player IsoPlayer
function HoldTheDoor.clearPlayerModData(player)
    if player == nil or not player:hasModData() then return end
    player:getModData()[HoldTheDoor.Keys.PLAYER_HOLDING] = nil
end

--- Restore an orphaned held door to its original HP and clear its ModData.
--- Safe to call on any door; no-ops if the door has no hold ModData.
--- Does NOT touch player ModData (caller is responsible).
---@param door IsoDoor|IsoThumpable
---@return boolean restored  -- true if the door was actually orphaned and fixed
function HoldTheDoor.restoreOrphanedDoor(door)
    if door == nil or not door:hasModData() then return false end
    local md = door:getModData()
    if md[HoldTheDoor.Keys.IS_HELD] ~= true then return false end

    local origMax = md[HoldTheDoor.Keys.ORIGINAL_MAX_HP]
    if origMax and origMax > 0 then
        local currentMax = door:getMaxHealth()
        local currentHealth = door:getHealth()
        local healthRatio = 1.0
        if currentMax > 0 then
            healthRatio = currentHealth / currentMax
        end
        local restoredHealth = math.max(0, math.floor(origMax * healthRatio))
        door:setMaxHealth(origMax)
        door:setHealth(math.min(restoredHealth, origMax))
    end

    HoldTheDoor.clearDoorModData(door)
    return true
end

return HoldTheDoor
