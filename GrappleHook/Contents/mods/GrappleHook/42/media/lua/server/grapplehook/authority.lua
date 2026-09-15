-- Grapple Hook: server-side authority.
--
-- The client sends only the square it aimed at; every rule is re-checked here
-- before a window is broken or a rope is spent.
require "grapplehook/core"
require "grapplehook/attach"
if isClient() then return end

local GH = GrappleHook

Events.OnClientCommand.Add(function(module, command, player, args)
    if module ~= GH.module or command ~= GH.commandFire then return end
    local ok, reason = GH.execute(player, args)
    GH.log("fire from", player:getUsername(), tostring(ok), tostring(reason))
    sendServerCommand(player, GH.module, GH.commandResult, {ok = ok, reason = reason})
end)
