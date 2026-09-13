HoldTheDoor = HoldTheDoor or {}
local H = HoldTheDoor
H.module = "HoldTheDoor"
H.key = "holdthedoor_session"
H.actions = H.actions or {}
H.lease = 5000

function H.isDoor(door)
    return door and (instanceof(door, "IsoDoor")
        or (instanceof(door, "IsoThumpable") and door:isDoor()))
end

function H.exists(door)
    return H.isDoor(door) and door:getSquare() ~= nil and door:getObjectIndex() >= 0
end

function H.broken(door)
    return H.isDoor(door) and (door:isDestroyed() or door:getHealth() <= 0)
end

function H.held(door)
    return H.isDoor(door) and type(door:getModData()[H.key]) == "table"
end

function H.eligible(door)
    if not H.exists(door) or H.broken(door) or door:IsOpen()
        or door:isLocked() or door:isLockedByKey() or door:isBarricaded() then return false end
    if instanceof(door, "IsoThumpable") and (door:isLockedByPadlock()
        or door:getLockedByCode() ~= 0) then return false end
    -- Multi-tile doors move/destroy several objects as one; a single panel is
    -- not a safe HP or interaction boundary.
    return IsoDoor.getDoubleDoorIndex(door) == -1 and IsoDoor.getGarageDoorIndex(door) == -1
end

function H.fit(player)
    return player and not player:isDead() and not player:isAsleep()
        and not player:isOnFloor() and not player:isKnockedDown()
        and not player:isBumpFall() and not player:isSitOnGround()
        and player:getVehicle() == nil
end

function H.adjacent(player, door)
    if not H.exists(door) or not player or not player:getCurrentSquare() then return false end
    local p, s = player:getCurrentSquare(), door:getSquare()
    if p:getZ() ~= s:getZ() then return false end
    if door:getNorth() then
        return p:getX() == s:getX() and (p:getY() == s:getY() or p:getY() == s:getY() - 1)
    end
    return p:getY() == s:getY() and (p:getX() == s:getX() or p:getX() == s:getX() - 1)
end

function H.face(player, door)
    if not H.adjacent(player, door) then return false end
    local p, s = player:getCurrentSquare(), door:getSquare()
    -- A north-edge door separates its square from y-1; a west-edge door
    -- separates it from x-1. Face the edge normally, regardless of sub-tile
    -- position. faceLocation() adds 0.5 to both coordinates and is unsuitable
    -- for edge coordinates. This matches vanilla faceThisObject's door logic.
    local direction
    if door:getNorth() then
        direction = p:getY() == s:getY() and IsoDirections.N or IsoDirections.S
    else
        direction = p:getX() == s:getX() and IsoDirections.W or IsoDirections.E
    end
    player:faceDirection(direction)
    return true
end

function H.multiplier()
    local value = tonumber((SandboxVars.HoldTheDoor or {}).HPMultiplier) or 3
    if value ~= value then value = 3 end
    return math.max(1.5, math.min(10, value))
end

function H.reference(door, token)
    local s = door:getSquare()
    return {x = s:getX(), y = s:getY(), z = s:getZ(), index = door:getObjectIndex(),
        north = door:getNorth(), sprite = door:getSprite():getName(), token = token}
end

function H.resolve(args)
    if type(args) ~= "table" then return nil end
    for _, key in ipairs({"x", "y", "z", "index"}) do
        local n = args[key]
        if type(n) ~= "number" or n ~= n or math.abs(n) > 10000000 or n ~= math.floor(n) then return nil end
    end
    local s = getCell():getGridSquare(args.x, args.y, args.z)
    if not s then return nil end
    local objects = s:getObjects()
    if args.index < 0 or args.index >= objects:size() then return nil end
    local door = objects:get(args.index)
    if H.isDoor(door) and door:getNorth() == args.north and door:getSprite()
        and door:getSprite():getName() == args.sprite then return door end
end

function H.sync(door)
    if isServer() and H.exists(door) then
        door:transmitModData()
        door:sync()
    end
end

function H.restore(door)
    local data = door:getModData()[H.key]
    if type(data) ~= "table" then return end
    door:getModData()[H.key] = nil -- clear first: cleanup is re-entrant
    if not H.broken(door) and type(data.multiplier) == "number" and data.multiplier >= 1
        and type(data.original) == "number" then
        -- Round down so repeated release/re-hold never heals damage. A surviving
        -- door remains at least 1 HP; zero is handled by the game's destruction.
        door:setHealth(math.max(1, math.min(data.original, math.floor(door:getHealth() / data.multiplier))))
    end
    H.sync(door)
end

return H
