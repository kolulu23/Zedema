require "holdthedoor/core"
require "TimedActions/ISOpenCloseDoor"
require "TimedActions/ISLockDoor"
local H = HoldTheDoor

function H.blocked(player, door)
    return H.actions[player] ~= nil or H.held(door)
        or (H.sessions and H.sessions[player] ~= nil)
end

local function protect(class, field)
    local valid, complete = class.isValid, class.complete
    function class:isValid()
        return not H.blocked(self.character, self[field]) and valid(self)
    end
    function class:complete()
        if H.blocked(self.character, self[field]) then return false end
        return complete(self)
    end
end
protect(ISOpenCloseDoor, "item")
protect(ISLockDoor, "door")
