local HoldTheDoor = require("HoldTheDoor/HoldTheDoorShared")

---@class HoldTheDoorAction : ISBaseTimedAction
---@field door IsoDoor|IsoThumpable
---@field originalHealth number
---@field originalMaxHealth number
local HoldTheDoorAction = ISBaseTimedAction:derive("HoldTheDoorAction")
HoldTheDoorAction.Type = "HoldTheDoorAction"

--- Create a new HoldTheDoorAction.
---@param character IsoPlayer
---@param door IsoDoor|IsoThumpable
---@return HoldTheDoorAction
function HoldTheDoorAction:new(character, door)
    local o = ISBaseTimedAction.new(self, character)
    ---@cast o HoldTheDoorAction
    o.door = door
    o.loopedAction = true
    o.stopOnWalk = true
    o.stopOnRun = true
    o.stopOnAim = true
    -- Large maxTime so the action persists until the player moves or cancels.
    -- The looped flag keeps it running; stopOnWalk auto-cancels on movement.
    o.maxTime = -1
    o.useProgressBar = false
    return o
end

function HoldTheDoorAction:isValid()
    -- Door must still exist in the world
    if self.door == nil then return false end

    -- Door must still be a valid door object on a square
    local sq = self.door:getSquare()
    if sq == nil then return false end

    -- Door must remain closed
    if self.door:IsOpen() then return false end

    -- Door must have HP remaining (not yet destroyed)
    if self.door:getHealth() <= 0 then return false end

    -- Door must not have been barricaded while held
    if self.door:isBarricaded() then return false end

    return true
end

function HoldTheDoorAction:start()
    -- Face the door
    self.character:faceThisObject(self.door)

    -- Set animation — placeholder; swap for custom anim later
    self:setActionAnim("Shove")

    -- Read current HP before modification
    self.originalHealth = self.door:getHealth()
    self.originalMaxHealth = self.door:getMaxHealth()

    -- Apply HP multiplier
    local multiplier = HoldTheDoor.getHPMultiplier()
    local boostedMax = math.floor(self.originalMaxHealth * multiplier)
    local boostedHealth = math.floor(self.originalHealth * multiplier)
    self.door:setMaxHealth(boostedMax)
    self.door:setHealth(boostedHealth)

    -- Tag the door via ModData
    local doorMD = self.door:getModData()
    doorMD[HoldTheDoor.Keys.IS_HELD] = true
    doorMD[HoldTheDoor.Keys.PLAYER_ID] = self.character:getOnlineID()
    doorMD[HoldTheDoor.Keys.ORIGINAL_HEALTH] = self.originalHealth
    doorMD[HoldTheDoor.Keys.ORIGINAL_MAX_HP] = self.originalMaxHealth

    -- Tag the player
    self.character:getModData()[HoldTheDoor.Keys.PLAYER_HOLDING] = true
end

function HoldTheDoorAction:update()
    -- Keep facing the door while holding
    self.character:faceThisObject(self.door)

    -- Force the action to stay active (reset progress so it never completes on its own)
    self:setActionAnim("Shove")
end

function HoldTheDoorAction:stop()
    self:restoreDoor()
    ISBaseTimedAction.stop(self)
end

function HoldTheDoorAction:perform()
    self:restoreDoor()
    ISBaseTimedAction.perform(self)
end

--- Restore the door to its original HP (proportionally) and clear all ModData tags.
--- Idempotent: safe to call multiple times (stop + OnDestroyIsoThumpable race).
function HoldTheDoorAction:restoreDoor()
    -- Guard: only run cleanup once per action instance
    if self._restored then return end
    self._restored = true

    local door = self.door
    if door == nil then
        HoldTheDoor.clearPlayerModData(self.character)
        return
    end

    -- Delegate to shared restore utility (handles HP math + door ModData)
    HoldTheDoor.restoreOrphanedDoor(door)
    HoldTheDoor.clearPlayerModData(self.character)
end

return HoldTheDoorAction
