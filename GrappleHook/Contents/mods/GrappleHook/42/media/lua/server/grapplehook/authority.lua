-- Grapple Hook: server-side authority.
--
-- The client sends only the square it aimed at; every rule is re-checked here
-- before a window is broken or a rope is spent.
require "grapplehook/core"
require "grapplehook/attach"
if isClient() then return end

Events.OnClientCommand.Add(function(module, command, player, args)
    if module ~= GrappleHook.module or command ~= GrappleHook.commandFire then return end
    local ok, reason = GrappleHook.execute(player, args)
    GrappleHook.log("fire from", player:getUsername(), tostring(ok), tostring(reason))
    sendServerCommand(player, GrappleHook.module, GrappleHook.commandResult, { ok = ok, reason = reason })
end)
