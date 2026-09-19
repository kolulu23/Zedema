-- Grapple Hook: cursor reticle showing whether the shot would land.
require "ISUI/ISUIElement"
require "grapplehook/core"
require "grapplehook/targeting"

---@type ISGrappleReticle?
GrappleHook.reticle = nil

---@class ISGrappleReticle : ISUIElement Cursor reticle showing whether the shot
--- would land.
---@field player IsoPlayer The player whose cursor this reticle tracks.
ISGrappleReticle = ISUIElement:derive("ISGrappleReticle")

function ISGrappleReticle:initialise()
    ISUIElement.initialise(self)
    -- Never swallow world clicks: the fire input has to reach the player.
    self:setWantMouseEvents(false)
end

function ISGrappleReticle:render()
    local player = self.player
    if not player or player:isDead() or not GrappleHook.heldHook(player) then return end

    local mouseX, mouseY = getMouseXScaled(), getMouseYScaled()
    local verdict, rejected = GrappleHook.findTarget(player, mouseX, mouseY, {cell = getCell()})
    local state = verdict or rejected
    local r, g, b = 0.85, 0.35, 0.2
    if verdict then r, g, b = 0.35, 0.85, 0.35 end

    -- Four ticks around the cursor.
    local arm, gap = 11, 4
    self:drawRect(mouseX - gap - arm, mouseY - 1, arm, 2, 0.85, r, g, b)
    self:drawRect(mouseX + gap, mouseY - 1, arm, 2, 0.85, r, g, b)
    self:drawRect(mouseX - 1, mouseY - gap - arm, 2, arm, 0.85, r, g, b)
    self:drawRect(mouseX - 1, mouseY + gap, 2, arm, 0.85, r, g, b)

    if not state then return end
    local text = getText(state.reason)
    if verdict then
        text = text .. "  (" .. string.gsub(getText("UI_GH_RopeCost"), "%%1", tostring(state.cost)) .. ")"
    end
    self:drawTextCentre(text, mouseX, mouseY + 18, r, g, b, 1, UIFont.Small)
end

---@param player IsoPlayer The player the reticle belongs to.
---@return ISGrappleReticle
function ISGrappleReticle:new(player)
    local o = ISUIElement.new(self, 0, 0, getCore():getScreenWidth(), getCore():getScreenHeight())
    o.player = player
    return o
end
