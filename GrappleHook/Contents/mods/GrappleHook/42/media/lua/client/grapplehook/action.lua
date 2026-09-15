-- Grapple Hook: the shot itself.
--
-- The vanilla attack is cancelled by the Attack hook (see client.lua), so this
-- timed action supplies the pose, the noise and the request instead.
require "TimedActions/ISBaseTimedAction"
require "TimedActions/ISTimedActionQueue"
require "grapplehook/core"
require "grapplehook/targeting"

local GH = GrappleHook

ISGrappleHookFire = ISBaseTimedAction:derive("ISGrappleHookFire")

local function targetOf(self)
    local square = getCell():getGridSquare(self.x, self.y, self.z)
    return square, square and GH.windowOn(square, self.character)
end

function ISGrappleHookFire:isValid()
    local player = self.character
    if not player or player:isDead() or not GH.heldHook(player) then return false end
    local square, window = targetOf(self)
    if not square or not window then return false end
    return GH.evaluate(player, square, window, {cell = getCell()}).ok == true
end

function ISGrappleHookFire:start()
    local player = self.character
    player:playSound(GH.launchSound)
    local radius = GH.noiseRadius()
    if radius > 0 then
        -- The launcher is loud: zombies are drawn to it unless the player is hidden.
        player:addWorldSoundUnlessInvisible(radius, radius, false)
    end
end

function ISGrappleHookFire:update() end

function ISGrappleHookFire:stop()
    ISBaseTimedAction.stop(self)
end

function ISGrappleHookFire:perform()
    local player = self.character
    local request = {x = self.x, y = self.y, z = self.z}
    if isClient() then
        sendClientCommand(player, GH.module, GH.commandFire, request)
    else
        -- Singleplayer: the server half of the mod is already in this process.
        GH.execute(player, request)
    end
    ISBaseTimedAction.perform(self)
end

function ISGrappleHookFire:new(player, verdict)
    local o = ISBaseTimedAction.new(self, player)
    o.x, o.y, o.z = verdict.x, verdict.y, verdict.z
    o.maxTime, o.loopedAction, o.useProgressBar = 40, false, true
    o.forceProgressBar = true
    o.stopOnWalk, o.stopOnRun, o.stopOnAim = true, true, false
    return o
end
