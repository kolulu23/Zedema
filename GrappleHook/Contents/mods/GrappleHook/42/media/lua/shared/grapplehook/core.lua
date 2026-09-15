-- Grapple Hook: shared constants, sandbox access and small helpers.
GrappleHook = GrappleHook or {}
local GH = GrappleHook

GH.version = "0.1.0"
GH.module = "grappleHook"
GH.commandFire = "fire"
GH.commandResult = "result"

GH.hookItem = "Base.GrappleHook"
GH.ropeItem = "Base.Rope"
-- The engine matches either the short or the full id (ItemContainer.RemoveAll
-- compares item.type and item.fullType), and vanilla counts escape ropes with the
-- short id, so counting uses the same spelling the vanilla menu uses.
GH.ropeItemKey = "Rope"
-- Sound name the engine itself references, used for the launch.
GH.launchSound = "AttackShove"

GH.defaults = {
    maxFloors = 2,
    maxRange = 6.0,
    breakWindows = true,
    noiseRadius = 15,
    debug = false,
}

local function option(key, fallback)
    local vars = SandboxVars and SandboxVars.GrappleHook
    local value = vars and vars[key]
    if value == nil then return fallback end
    return value
end

function GH.maxFloors()
    local value = math.floor(option("MaxFloors", GH.defaults.maxFloors))
    if value < 1 then return 1 end
    if value > 3 then return 3 end
    return value
end

function GH.maxRange() return option("MaxRange", GH.defaults.maxRange) end
function GH.breakWindows() return option("BreakWindows", GH.defaults.breakWindows) == true end
function GH.noiseRadius() return math.floor(option("NoiseRadius", GH.defaults.noiseRadius)) end
function GH.debug() return option("Debug", GH.defaults.debug) == true end

function GH.log(...)
    if GH.debug() then print("[GrappleHook]", ...) end
end

function GH.isHook(item)
    return item ~= nil and item:getFullType() == GH.hookItem
end

function GH.heldHook(player)
    if not player then return nil end
    local primary = player:getPrimaryHandItem()
    if GH.isHook(primary) then return primary end
    return nil
end

function GH.ropeCount(player)
    local inventory = player and player:getInventory()
    if not inventory then return 0 end
    return inventory:getItemCountRecurse(GH.ropeItemKey)
end

function GH.distance2d(ax, ay, bx, by)
    local dx, dy = ax - bx, ay - by
    return math.sqrt(dx * dx + dy * dy)
end

--- The window on the side the character is standing on, else the other one.
function GH.windowOn(square, character)
    if not square then return nil end
    local north = character ~= nil and character:getY() < square:getY()
    local window = square:getWindow(north)
    if window then return window end
    return square:getWindow(not north)
end
