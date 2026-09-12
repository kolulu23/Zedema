local HoldTheDoor = require("HoldTheDoor/HoldTheDoorShared")

local HoldTheDoorClient = {}

---------------------------------------------------------------------------
-- Save/load cleanup: on game start, scan all players for orphaned
-- holdTheDoor_heldDoor flags and clear them. Orphaned door cleanup is
-- handled lazily via canHoldDoor (HoldTheDoorShared) when a player
-- next interacts with a door, since not all cells are loaded yet at
-- OnGameStart time and LoadGridsquare may fire later.
---------------------------------------------------------------------------
function HoldTheDoorClient.OnGameStart()
    local status, err = pcall(function()
        local numPlayers = getNumActivePlayers()
        for i = 0, numPlayers - 1 do
            local player = getSpecificPlayer(i)
            if player then
                HoldTheDoor.clearPlayerModData(player)
            end
        end
    end)
    if not status then
        print("ERROR: HoldTheDoor.OnGameStart: " .. tostring(err))
    end
end

Events.OnGameStart.Add(HoldTheDoorClient.OnGameStart)

return HoldTheDoorClient
