-- Grapple Hook: client entry point.
--
-- Interception point is Hook.Attack. IsoLivingCharacter.AttemptAttack calls
-- LuaHookManager.TriggerHook("Attack", ...) before DoAttack, and Lua/Event.java
-- discards the callback result and reports "handled" whenever any listener is
-- registered. A registered listener therefore cancels every attack, whatever the
-- callback returns, so it is registered only while the grapple hook is actually in
-- hand. If the registration is ever stale, the attack is re-issued through
-- IsoPlayer:AttemptAttack(), which does not pass through the hook.
require "grapplehook/core"
require "grapplehook/targeting"
require "grapplehook/attach"
require "grapplehook/action"
require "grapplehook/reticle"
require "TimedActions/ISTimedActionQueue"

local registered = false

---@param player IsoPlayer
local function fire(player)
    local verdict = GrappleHook.findTarget(player, getMouseXScaled(), getMouseYScaled(), {cell = getCell()})
    if not verdict then
        GrappleHook.log("no grapple target under the cursor")
        return
    end
    ISTimedActionQueue.add(ISGrappleHookFire:new(player, verdict))
end

---@param player IsoPlayer
---@param chargeDelta number
---@param weapon InventoryItem? The item the interrupted attack was made with.
local function onAttack(player, chargeDelta, weapon)
    -- The hook reports the item the attack was made with (leftHandItem). Anything
    -- else means the attack belongs to another weapon, so it is re-issued through
    -- the path that bypasses the hook instead of being swallowed.
    if not GrappleHook.isHook(weapon) then
        player:AttemptAttack()
        return
    end
    fire(player)
end

---@param value boolean
local function setRegistered(value)
    if value == registered then return end
    registered = value
    if value then Hook.Attack.Add(onAttack) else Hook.Attack.Remove(onAttack) end
end

---@param player IsoPlayer
---@param show boolean
local function setReticle(player, show)
    local reticle = GrappleHook.reticle
    if not show then
        if reticle then reticle:removeFromUIManager() end
        GrappleHook.reticle = nil
        return
    end
    local width, height = getCore():getScreenWidth(), getCore():getScreenHeight()
    if reticle and reticle.width == width and reticle.height == height then return end
    if reticle then reticle:removeFromUIManager() end
    reticle = ISGrappleReticle:new(player)
    reticle:initialise()
    reticle:addToUIManager()
    GrappleHook.reticle = reticle
end

---@param player IsoPlayer
local function sync(player)
    local held = GrappleHook.heldHook(player) ~= nil
    setRegistered(held)
    setReticle(player, held)
end

Events.OnPlayerUpdate.Add(function(player)
    if not player:isLocalPlayer() then return end
    sync(player)
end)

---@param character IsoGameCharacter
local function onEquip(character)
    -- OnEquipPrimary/Secondary carry an IsoGameCharacter, which can be a zombie or
    -- an animal; only players answer isLocalPlayer().
    if not instanceof(character, "IsoPlayer") then return end
    ---@cast character IsoPlayer
    if character:isLocalPlayer() then sync(character) end
end

Events.OnEquipPrimary.Add(onEquip)
Events.OnEquipSecondary.Add(onEquip)

Events.OnPlayerDeath.Add(function(player)
    if not player:isLocalPlayer() then return end
    setRegistered(false)
    setReticle(player, false)
end)

Events.OnServerCommand.Add(function(module, command, args)
    if module ~= GrappleHook.module or command ~= GrappleHook.commandResult then return end
    if type(args) ~= "table" or args.ok then return end
    GrappleHook.log("server refused the shot:", tostring(args.reason))
end)
