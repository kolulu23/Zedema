local HoldTheDoor = require("HoldTheDoor/HoldTheDoorShared")

local HoldTheDoorServer = {}

---------------------------------------------------------------------------
-- Called when any IsoThumpable is destroyed (health reaches 0).
-- If the destroyed object is a door being held, knock the holder down.
---@param object IsoObject
---@param playerObj IsoPlayer|nil
---------------------------------------------------------------------------
function HoldTheDoorServer.OnDestroyIsoThumpable(object, playerObj)
    -- Fast early-return: skip objects without our ModData
    if object == nil then return end
    if not object:hasModData() then return end

    local md = object:getModData()
    if md[HoldTheDoor.Keys.IS_HELD] ~= true then return end

    -- This was a held door — find the holding player
    local holderID = md[HoldTheDoor.Keys.PLAYER_ID]
    if holderID == nil then return end

    local holder = getPlayerByOnlineID(holderID)
    if holder == nil then return end

    -- Knock the player down (stumble/trip)
    holder:setKnockedDown(true)

    -- Clear player ModData so they can hold another door
    HoldTheDoor.clearPlayerModData(holder)

    -- Door ModData will be garbage collected with the object
end

---------------------------------------------------------------------------
-- Fallback: called when any object is about to be removed from the world.
-- Covers edge cases where the door is removed without going through
-- the normal destruction path (e.g. admin removal, mod interference).
---@param object IsoObject
---------------------------------------------------------------------------
function HoldTheDoorServer.OnObjectAboutToBeRemoved(object)
    if object == nil then return end
    if not object:hasModData() then return end

    local md = object:getModData()
    if md[HoldTheDoor.Keys.IS_HELD] ~= true then return end

    local holderID = md[HoldTheDoor.Keys.PLAYER_ID]
    if holderID == nil then return end

    local holder = getPlayerByOnlineID(holderID)
    if holder == nil then return end

    -- Just clean up player state — no knockdown for non-combat removal
    HoldTheDoor.clearPlayerModData(holder)
end

Events.OnDestroyIsoThumpable.Add(HoldTheDoorServer.OnDestroyIsoThumpable)
Events.OnObjectAboutToBeRemoved.Add(HoldTheDoorServer.OnObjectAboutToBeRemoved)

---------------------------------------------------------------------------
-- Save/load cleanup: on game start, scan all players for orphaned
-- holdTheDoor_heldDoor flags and clear them. The matching door's HP
-- is restored lazily via OnLoadGridsquare (below) since not all cells
-- are loaded yet at OnGameStart time.
---------------------------------------------------------------------------
function HoldTheDoorServer.OnGameStart()
    local numPlayers = getNumActivePlayers()
    for i = 0, numPlayers - 1 do
        local player = getSpecificPlayer(i)
        if player then
            HoldTheDoor.clearPlayerModData(player)
        end
    end
end

Events.OnGameStart.Add(HoldTheDoorServer.OnGameStart)

---------------------------------------------------------------------------
-- When a grid square loads, check its objects for orphaned held doors.
-- This catches doors whose holder disconnected or the game was saved
-- mid-hold. Runs once per square load — no per-tick overhead.
---@param square IsoGridSquare
---------------------------------------------------------------------------
function HoldTheDoorServer.OnLoadGridsquare(square)
    if square == nil then return end
    local objects = square:getObjects()
    for i = 0, objects:size() - 1 do
        local obj = objects:get(i)
        if obj and obj:hasModData() then
            local md = obj:getModData()
            if md[HoldTheDoor.Keys.IS_HELD] == true then
                ---@cast obj IsoDoor|IsoThumpable
                HoldTheDoor.restoreOrphanedDoor(obj)
            end
        end
    end
end

Events.OnLoadGridsquare.Add(HoldTheDoorServer.OnLoadGridsquare)

---------------------------------------------------------------------------
-- MP: when a player disconnects, clean up any door they were holding.
-- We don't scan all cells (expensive); instead we just clear the player
-- flag. The door's orphaned ModData will be cleaned up by
-- OnLoadGridsquare when the chunk is next loaded.
---@param player IsoPlayer
---------------------------------------------------------------------------
function HoldTheDoorServer.OnPlayerDisconnect(player)
    if player == nil then return end
    HoldTheDoor.clearPlayerModData(player)
end

Events.OnPlayerDisconnect.Add(HoldTheDoorServer.OnPlayerDisconnect)

return HoldTheDoorServer
