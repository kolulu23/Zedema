-- Grapple Hook: the authoritative attach step.
--
-- Runs on the server, and in singleplayer where the server half runs in-process.
-- Everything the client proposed is re-validated here: the client owns the aim
-- and the visuals, never the outcome.
require "grapplehook/core"
require "grapplehook/targeting"

---@class grapplehook.FireArgs The square a client asks the server to fire at.
---@field x number Aimed world X.
---@field y number Aimed world Y.
---@field z number Aimed world Z.

--- Breaks the window when the shot needs it, then ties the rope to it.
-- The rope is spent by the engine: IsoWindow.addSheetRope removes one rope item
-- per level the rope spans and a nail when the player carries one, which is the
-- same rule the vanilla "Add escape rope" menu uses.
---@param player IsoPlayer?
---@param args grapplehook.FireArgs?
---@return boolean Whether the shot was accepted.
---@return string UI string key describing the outcome.
function GrappleHook.execute(player, args)
    if not player or player:isDead() then return false, "UI_GH_Invalid" end
    -- The client only proposes. The launcher must really be in hand, which the
    -- server can check for itself.
    if not GrappleHook.heldHook(player) then return false, "UI_GH_Invalid" end
    if type(args) ~= "table" then return false, "UI_GH_Invalid" end

    local x, y, z = tonumber(args.x), tonumber(args.y), tonumber(args.z)
    if not x or not y or not z then return false, "UI_GH_Invalid" end

    local cell = getCell()
    local square = cell:getGridSquare(math.floor(x), math.floor(y), math.floor(z))
    local window = square and GrappleHook.windowOn(square, player)
    if not window then return false, "UI_GH_NoWindow" end

    local verdict = GrappleHook.evaluate(player, square, window, {cell = cell})
    if not verdict.ok then return false, verdict.reason end

    if verdict.breakWindow then
        -- Shards, sound and the house-alarm rule all come from the engine.
        window:smashWindow()
    end

    if not window:addSheetRope(player, GrappleHook.ropeItem) then
        return false, "UI_GH_AttachFailed"
    end

    GrappleHook.log("rope tied", square:getX(), square:getY(), square:getZ(), "ropes spent", verdict.cost)
    return true, "UI_GH_Attached"
end
