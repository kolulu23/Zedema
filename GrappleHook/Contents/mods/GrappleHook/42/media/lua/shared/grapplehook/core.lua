-- Grapple Hook: shared constants, sandbox access and small helpers.

---@class grapplehook.Module Grapple Hook shared API. Defined incrementally by the
--- files that require this one, so callers in any file see the whole surface.
---@field version string
---@field module string Network command module name.
---@field commandFire string Client -> server command name.
---@field commandResult string Server -> client answer command name.
---@field hookItem string Full type of the launcher item.
---@field ropeItem string Full type of the rope items spent as ammunition.
---@field ropeItemKey string Short id used when counting rope items.
---@field launchSound string Sound script played on launch.
---@field defaults table<string, any> Sandbox option defaults.
---@field isHook fun(item: InventoryItem?): boolean
---@field heldHook fun(player: IsoPlayer?): InventoryItem?
---@field ropeCount fun(player: IsoPlayer?): integer
---@field distance2d fun(ax: number, ay: number, bx: number, by: number): number
---@field windowOn fun(square: IsoGridSquare?, character: IsoGameCharacter?): IsoWindow?
---@field evaluate fun(player: IsoPlayer?, square: IsoGridSquare?, window: IsoWindow?, opts: grapplehook.TargetOpts?): grapplehook.Verdict
---@field findTarget fun(player: IsoPlayer?, mouseX: number, mouseY: number, opts: grapplehook.TargetOpts?): grapplehook.Verdict?, grapplehook.Verdict?
---@field execute fun(player: IsoPlayer?, args: grapplehook.FireArgs?): boolean, string
---@field reticle ISGrappleReticle? The client cursor reticle while the hook is equipped.
GrappleHook = GrappleHook or {}

GrappleHook.version = "0.1.0"
GrappleHook.module = "grappleHook"
GrappleHook.commandFire = "fire"
GrappleHook.commandResult = "result"

GrappleHook.hookItem = "Base.GrappleHook"
GrappleHook.ropeItem = "Base.Rope"
-- The engine matches either the short or the full id (ItemContainer.RemoveAll
-- compares item.type and item.fullType), and vanilla counts escape ropes with the
-- short id, so counting uses the same spelling the vanilla menu uses.
GrappleHook.ropeItemKey = "Rope"
-- Sound name the engine itself references, used for the launch.
GrappleHook.launchSound = "AttackShove"

---@type {maxFloors: integer, maxRange: number, breakWindows: boolean, noiseRadius: integer, debug: boolean}
GrappleHook.defaults = {
    maxFloors = 2,
    maxRange = 6.0,
    breakWindows = true,
    noiseRadius = 15,
    debug = false,
}

---@param key string Sandbox option name.
---@param fallback any Default when the option is absent.
---@return any The sandbox value if set, else the fallback.
local function option(key, fallback)
    local vars = SandboxVars and SandboxVars.GrappleHook
    local value = vars and vars[key]
    if value == nil then return fallback end
    return value
end

---@return integer
function GrappleHook.maxFloors()
    local value = math.floor(option("MaxFloors", GrappleHook.defaults.maxFloors))
    if value < 1 then return 1 end
    if value > 3 then return 3 end
    return value
end

---@return number
function GrappleHook.maxRange() return option("MaxRange", GrappleHook.defaults.maxRange) end
---@return boolean
function GrappleHook.breakWindows() return option("BreakWindows", GrappleHook.defaults.breakWindows) == true end
---@return integer
function GrappleHook.noiseRadius() return math.floor(option("NoiseRadius", GrappleHook.defaults.noiseRadius)) end
---@return boolean
function GrappleHook.debug() return option("Debug", GrappleHook.defaults.debug) == true end

---@param ... any
function GrappleHook.log(...)
    if GrappleHook.debug() then print("[GrappleHook]", ...) end
end

---@param item InventoryItem?
---@return boolean
function GrappleHook.isHook(item)
    return item ~= nil and item:getFullType() == GrappleHook.hookItem
end

---@param player IsoPlayer?
---@return InventoryItem?
function GrappleHook.heldHook(player)
    if not player then return nil end
    local primary = player:getPrimaryHandItem()
    if GrappleHook.isHook(primary) then return primary end
    return nil
end

---@param player IsoPlayer?
---@return integer
function GrappleHook.ropeCount(player)
    local inventory = player and player:getInventory()
    if not inventory then return 0 end
    return inventory:getItemCountRecurse(GrappleHook.ropeItemKey)
end

---@param ax number
---@param ay number
---@param bx number
---@param by number
---@return number
function GrappleHook.distance2d(ax, ay, bx, by)
    local dx, dy = ax - bx, ay - by
    return math.sqrt(dx * dx + dy * dy)
end

--- The window on the side the character is standing on, else the other one.
---@param square IsoGridSquare?
---@param character IsoGameCharacter?
---@return IsoWindow?
function GrappleHook.windowOn(square, character)
    if not square then return nil end
    local north = character ~= nil and character:getY() < square:getY()
    local window = square:getWindow(north)
    if window then return window end
    return square:getWindow(not north)
end
