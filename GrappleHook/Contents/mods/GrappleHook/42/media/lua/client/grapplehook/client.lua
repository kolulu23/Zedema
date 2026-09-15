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

local GH = GrappleHook
local registered = false

local function fire(player)
    local verdict = GH.findTarget(player, getMouseXScaled(), getMouseYScaled(), {cell = getCell()})
    if not verdict then
        GH.log("no grapple target under the cursor")
        return
    end
    ISTimedActionQueue.add(ISGrappleHookFire:new(player, verdict))
end

local function onAttack(player, chargeDelta, weapon)
    -- The hook reports the item the attack was made with (leftHandItem). Anything
    -- else means the attack belongs to another weapon, so it is re-issued through
    -- the path that bypasses the hook instead of being swallowed.
    if not GH.isHook(weapon) then
        player:AttemptAttack()
        return
    end
    fire(player)
end

local function setRegistered(value)
    if value == registered then return end
    registered = value
    if value then Hook.Attack.Add(onAttack) else Hook.Attack.Remove(onAttack) end
end

local function setReticle(player, show)
    local reticle = GH.reticle
    if not show then
        if reticle then reticle:removeFromUIManager() end
        GH.reticle = nil
        return
    end
    local width, height = getCore():getScreenWidth(), getCore():getScreenHeight()
    if reticle and reticle.width == width and reticle.height == height then return end
    if reticle then reticle:removeFromUIManager() end
    reticle = ISGrappleReticle:new(player)
    reticle:initialise()
    reticle:addToUIManager()
    GH.reticle = reticle
end

local function sync(player)
    local held = GH.heldHook(player) ~= nil
    setRegistered(held)
    setReticle(player, held)
end

Events.OnPlayerUpdate.Add(function(player)
    if not player:isLocalPlayer() then return end
    sync(player)
end)

local function onEquip(character)
    -- OnEquipPrimary/Secondary carry an IsoGameCharacter, which can be a zombie or
    -- an animal; only players answer isLocalPlayer().
    if not instanceof(character, "IsoPlayer") then return end
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
    if module ~= GH.module or command ~= GH.commandResult then return end
    if type(args) ~= "table" or args.ok then return end
    GH.log("server refused the shot:", tostring(args.reason))
end)
