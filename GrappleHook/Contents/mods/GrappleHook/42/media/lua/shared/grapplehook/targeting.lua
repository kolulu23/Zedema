-- Grapple Hook: target selection.
--
-- The shot belongs to this mod rather than to the engine: in Build 42 the bullet
-- is a hitscan owned by native ballistics that Lua cannot script (see
-- docs/adr/0001-grapple-hook.md). Selection therefore runs a small upward
-- raycast of its own: for every floor above the player, map the cursor into that
-- floor's tile grid with the same isometric projection the game uses, then take
-- the first window that passes every rule below.
require "grapplehook/core"

---@class grapplehook.Verdict Evaluation of one possible grapple target.
---@field ok boolean Whether the server would accept the shot.
---@field reason string UI string key describing the outcome or the refusal.
---@field cost integer Number of rope items the rope will spend.
---@field breakWindow boolean Whether the hook must smash the glass first.
---@field north boolean Which face of the window the rope would hang from.
---@field x integer World X of the aimed square (only set on ok verdicts).
---@field y integer World Y of the aimed square (only set on ok verdicts).
---@field z integer World Z of the aimed square (only set on ok verdicts).

---@class grapplehook.TargetOpts Overrides for a single targeting pass.
---@field cell IsoCell? Cell to search in (defaults to getCell()).
---@field maxFloors integer? Overrides the MaxFloors sandbox option.
---@field maxRange number? Overrides the MaxRange sandbox option.
---@field breakWindows boolean? Overrides the BreakWindows sandbox option.

---@param cell IsoCell
---@param character IsoGameCharacter
---@param square IsoGridSquare
---@return boolean
local function blockedByGeometry(cell, character, square)
    -- LosUtil.lineClear returns a Java enum that is not exposed to Lua, so the
    -- result is classified by name. An unreadable name counts as visible: the drop
    -- column, the window state and the rope count are validated anyway, and the
    -- server repeats this check before anything happens.
    local result = tostring(
        LosUtil.lineClear(cell,
            math.floor(character:getX()), math.floor(character:getY()), math.floor(character:getZ()),
            square:getX(), square:getY(), square:getZ(), false))
    return string.find(result, "Block") ~= nil
end

--- Decides whether one window can be grappled, and what the shot would cost.
---@param player IsoPlayer?
---@param square IsoGridSquare?
---@param window IsoWindow?
---@param opts grapplehook.TargetOpts?
---@return grapplehook.Verdict
function GrappleHook.evaluate(player, square, window, opts)
    opts = opts or {}
    local maxFloors = opts.maxFloors or GrappleHook.maxFloors()
    local maxRange = opts.maxRange or GrappleHook.maxRange()
    local allowBreak = opts.breakWindows
    if allowBreak == nil then allowBreak = GrappleHook.breakWindows() end

    ---@type grapplehook.Verdict
    local verdict = {ok = false, reason = "UI_GH_Invalid", cost = 0, breakWindow = false}
    if not player or not square or not window then
        verdict.reason = "UI_GH_NoWindow"
        return verdict
    end

    if window:isBarricaded() then
        verdict.reason = "UI_GH_Barricaded"
        return verdict
    end
    if window:haveSheetRope() then
        verdict.reason = "UI_GH_HasRope"
        return verdict
    end

    local north = window:getNorth()
    local cost = IsoWindow.countAddSheetRope(square, north)
    verdict.north = north
    verdict.cost = cost or 0
    if not cost or cost <= 0 then
        -- No clear column down to a floor: a rope could not hang from here.
        verdict.reason = "UI_GH_NoDrop"
        return verdict
    end

    local floorDelta = square:getZ() - math.floor(player:getZ())
    if floorDelta < 1 or floorDelta > maxFloors then
        verdict.reason = "UI_GH_WrongFloor"
        return verdict
    end

    local range = GrappleHook.distance2d(player:getX(), player:getY(), square:getX() + 0.5, square:getY() + 0.5)
    if range > maxRange then
        verdict.reason = "UI_GH_TooFar"
        return verdict
    end

    if not window:canClimbThrough(nil) then
        -- Closed and intact. The engine only accepts an escape rope on a window it
        -- can be climbed through (IsoWindow.canClimbThrough: health > 0 and intact
        -- means "only when open"), so the hook has to break the glass first.
        if window:isInvincible() then
            verdict.reason = "UI_GH_Unbreakable"
            return verdict
        end
        if not allowBreak then
            verdict.reason = "UI_GH_BreakDisabled"
            return verdict
        end
        verdict.breakWindow = true
    end

    if GrappleHook.ropeCount(player) < verdict.cost then
        verdict.reason = "UI_GH_NeedRopes"
        return verdict
    end

    if blockedByGeometry(opts.cell or getCell(), player, square) then
        verdict.reason = "UI_GH_OutOfSight"
        return verdict
    end

    verdict.ok = true
    verdict.x, verdict.y, verdict.z = square:getX(), square:getY(), square:getZ()
    verdict.reason = verdict.breakWindow and "UI_GH_WillBreak" or "UI_GH_Ready"
    return verdict
end

--- Finds the grapple target under the cursor, searching upwards.
---@param player IsoPlayer?
---@param mouseX number
---@param mouseY number
---@param opts grapplehook.TargetOpts?
---@return grapplehook.Verdict? The verdict for the nearest usable window, or nil
---         plus the reason the nearest candidate was rejected, which is what the
---         reticle shows.
---@return grapplehook.Verdict?
function GrappleHook.findTarget(player, mouseX, mouseY, opts)
    if not player then return nil end
    opts = opts or {}
    local cell = opts.cell or getCell()
    local index = player:getPlayerNum()
    local baseZ = math.floor(player:getZ())
    local floors = opts.maxFloors or GrappleHook.maxFloors()
    local rejected
    for floor = 1, floors do
        local z = baseZ + floor
        local wx = IsoUtils.XToIso(index, mouseX, mouseY, z)
        local wy = IsoUtils.YToIso(index, mouseX, mouseY, z)
        local square = cell:getGridSquare(math.floor(wx), math.floor(wy), z)
        local window = square and GrappleHook.windowOn(square, player)
        if window then
            local verdict = GrappleHook.evaluate(player, square, window, opts)
            if verdict.ok then return verdict end
            if not rejected then rejected = verdict end
        end
    end
    return nil, rejected
end
