-- Run from the repository root: lua GrappleHook/tests/lifecycle.lua
-- Strict, minimal doubles: an API the mod calls but the mock does not provide
-- fails the run instead of silently passing.
local root = "GrappleHook/Contents/mods/GrappleHook/42/media/lua/"
package.path = root .. "shared/?.lua;" .. root .. "client/?.lua;" .. root .. "server/?.lua;" .. package.path

local checks, failures = 0, 0
local function ok(condition, label)
    checks = checks + 1
    if not condition then
        failures = failures + 1
        print("FAIL: " .. label)
    end
end
local function eq(actual, expected, label)
    ok(actual == expected, label .. " (expected " .. tostring(expected) .. ", got " .. tostring(actual) .. ")")
end

-- ------------------------------------------------------------------ doubles
SandboxVars = {GrappleHook = {MaxFloors = 2, MaxRange = 6.0, BreakWindows = true, NoiseRadius = 15, Debug = false}}
UIFont = {Small = 0}
IsoDirections = {N = "N", S = "S", W = "W", E = "E"}

function isClient() return false end
function isServer() return true end
function getTimestampMs() return 1000 end

local mouseX, mouseY = 0, 0
function getMouseXScaled() return mouseX end
function getMouseYScaled() return mouseY end

local events = {}
Events = setmetatable({}, {__index = function(table_, key)
    local event = {callbacks = {}}
    function event.Add(callback) table.insert(event.callbacks, callback) end
    rawset(table_, key, event)
    return event
end})
local function fireEvent(name, ...)
    for _, callback in ipairs(Events[name].callbacks) do callback(...) end
end

local hookListeners = {}
Hook = {Attack = {
    Add = function(callback) table.insert(hookListeners, callback) end,
    Remove = function(callback)
        for index, listener in ipairs(hookListeners) do
            if listener == callback then table.remove(hookListeners, index) return end
        end
    end,
}}

-- Real isometric projection, 64 px per tile, so cursor maths is exercised too.
IsoUtils = {
    XToIso = function(_, screenX, screenY, floor) return (screenX + 2 * screenY) / 64 + 3 * floor end,
    YToIso = function(_, screenX, screenY, floor) return (screenX - 2 * screenY) / -64 + 3 * floor end,
}
local function cursorOver(worldX, worldY, floor)
    local screenY = 16 * (worldX + worldY - 6 * floor)
    local screenX = 64 * (worldX - 3 * floor) - 2 * screenY
    return screenX, screenY
end

local losBlocked = false
LosUtil = {lineClear = function() return losBlocked and "Blocked" or "Clear" end}

local squares = {}
local function addSquare(x, y, z, options)
    options = options or {}
    local square = {x = x, y = y, z = z, drop = options.drop or 2}
    function square:getX() return self.x end
    function square:getY() return self.y end
    function square:getZ() return self.z end
    function square:getWindow() return self.window end
    squares[x .. ":" .. y .. ":" .. z] = square
    return square
end

local function addWindow(square, options)
    options = options or {}
    local window = {
        north = options.north ~= false,
        barricaded = options.barricaded or false,
        hasRope = options.hasRope or false,
        invincible = options.invincible or false,
        climbable = options.climbable or false,
        smashCalls = 0,
        attachCalls = 0,
        attachItem = nil,
    }
    function window:getNorth() return self.north end
    function window:isBarricaded() return self.barricaded end
    function window:haveSheetRope() return self.hasRope end
    function window:isInvincible() return self.invincible end
    function window:isSmashed() return self.smashed end
    function window:canClimbThrough() return self.climbable end
    function window:smashWindow()
        self.smashCalls = self.smashCalls + 1
        self.smashed = true
        self.climbable = true
    end
    function window:addSheetRope(_, itemType)
        self.attachCalls = self.attachCalls + 1
        self.attachItem = itemType
        self.hasRope = true
        return true
    end
    square.window = window
    return window
end

IsoWindow = {
    countAddSheetRope = function(square) return square.drop or 0 end,
    canAddSheetRope = function(square) return (square.drop or 0) > 0 end,
}

local cell = {getGridSquare = function(_, x, y, z) return squares[x .. ":" .. y .. ":" .. z] end}
function getCell() return cell end

local hookItem = {getFullType = function() return "Base.GrappleHook" end}
local otherItem = {getFullType = function() return "Base.BaseballBat" end}

local function newPlayer(x, y, z, ropes)
    local player = {kind = "IsoPlayer", x = x, y = y, z = z, ropes = ropes or 0, attacks = 0, sounds = {}, noise = 0, primary = hookItem}
    function player:getX() return self.x end
    function player:getY() return self.y end
    function player:getZ() return self.z end
    function player:getPlayerNum() return 0 end
    function player:getInventory()
        local self_ = self
        return {getItemCountRecurse = function(_, key) self_.lastCountKey = key return self_.ropes end}
    end
    function player:getPrimaryHandItem() return self.primary end
    function player:getSecondaryHandItem() return self.secondary end
    function player:isDead() return false end
    function player:isLocalPlayer() return true end
    function player:getUsername() return "tester" end
    function player:playSound(name) table.insert(self.sounds, name) end
    function player:addWorldSoundUnlessInvisible(radius) self.noise = radius end
    function player:AttemptAttack() self.attacks = self.attacks + 1 return true end
    return player
end

-- Instances carry their class as __index, exactly like PZ's own derive/new do, so
-- instance methods (reticle:initialise) resolve the way they do in the game.
local function newClass(name, construct)
    local class = {type = name}
    class.__index = class
    class.new = function(self, ...)
        return setmetatable(construct(self, ...), {__index = self})
    end
    class.derive = function(self, derivedName)
        local sub = setmetatable({}, {__index = self})
        sub.type, sub.derive, sub.__index = derivedName, self.derive, sub
        sub.new = function(s, ...)
            return setmetatable(construct(s, ...), {__index = s})
        end
        return sub
    end
    return class
end

ISBaseTimedAction = newClass("ISBaseTimedAction", function(_, character)
    return {character = character, maxTime = 60}
end)
function ISBaseTimedAction.stop() end
function ISBaseTimedAction.perform() end

ISUIElement = newClass("ISUIElement", function(_, x, y, width, height)
    return {width = width, height = height}
end)
function ISUIElement.initialise() end
function ISUIElement.addToUIManager() end
function ISUIElement.removeFromUIManager() end
function ISUIElement.setWantMouseEvents() end
function ISUIElement.drawRect() end
function ISUIElement.drawTextCentre() end
function ISUIElement.render() end

local queued, replies = {}, {}
ISTimedActionQueue = {add = function(action) table.insert(queued, action) end}
function sendClientCommand() end
function sendServerCommand(_, _, _, args) table.insert(replies, args) end
function getCore() return {getScreenWidth = function() return 1280 end, getScreenHeight = function() return 720 end} end
function getText(key) return key end
function instanceof(object, name) return object ~= nil and object.kind == name end

local vanillaRequire = require
function require(name)
    if string.find(name, "^grapplehook/") then return vanillaRequire(name) end
    return true -- engine-side modules are mocked as globals above
end

vanillaRequire("grapplehook/core")
vanillaRequire("grapplehook/targeting")
vanillaRequire("grapplehook/attach")
vanillaRequire("grapplehook/action")
vanillaRequire("grapplehook/reticle")
vanillaRequire("grapplehook/client")
local GH = GrappleHook
vanillaRequire("grapplehook/authority")

-- ------------------------------------------------------------------ scenarios
do -- a closed window one floor up costs two ropes and must be broken first
    local player = newPlayer(10, 10, 0, 2)
    local square = addSquare(10, 9, 1)
    local window = addWindow(square)
    local verdict = GH.evaluate(player, square, window, {cell = cell})
    ok(verdict.ok, "closed window upstairs is a valid target")
    eq(verdict.cost, 2, "rope cost follows the engine escape-rope rule")
    eq(verdict.breakWindow, true, "closed window has to be broken")
    eq(GH.ropeCount(player), 2, "ropes are counted with the vanilla short id")
end

do -- one rope short
    local player = newPlayer(10, 10, 0, 1)
    local square = addSquare(10, 9, 1)
    local verdict = GH.evaluate(player, square, addWindow(square), {cell = cell})
    eq(verdict.ok, false, "insufficient ropes rejected")
    eq(verdict.reason, "UI_GH_NeedRopes", "reason is the rope shortage")
end

do -- barricaded, already roped, unbreakable and open windows
    local player = newPlayer(10, 10, 0, 4)
    local barricaded = addSquare(10, 9, 1)
    eq(GH.evaluate(player, barricaded, addWindow(barricaded, {barricaded = true}), {cell = cell}).reason,
        "UI_GH_Barricaded", "barricades are refused like the vanilla menu does")

    local roped = addSquare(11, 9, 1)
    eq(GH.evaluate(player, roped, addWindow(roped, {hasRope = true}), {cell = cell}).reason,
        "UI_GH_HasRope", "a window already carrying a rope is refused")

    local sealed = addSquare(12, 9, 1)
    eq(GH.evaluate(player, sealed, addWindow(sealed, {invincible = true}), {cell = cell}).reason,
        "UI_GH_Unbreakable", "an unbreakable closed window is refused")

    local open = addSquare(13, 9, 1)
    local openVerdict = GH.evaluate(player, open, addWindow(open, {climbable = true}), {cell = cell})
    ok(openVerdict.ok, "open window accepts a rope")
    eq(openVerdict.breakWindow, false, "open window is not broken")
end

do -- range, height, drop and sight rules
    local player = newPlayer(10, 10, 0, 4)

    local sameFloor = addSquare(10, 9, 0)
    eq(GH.evaluate(player, sameFloor, addWindow(sameFloor), {cell = cell}).reason,
        "UI_GH_WrongFloor", "only floors above the player are targeted")

    local tooHigh = addSquare(10, 9, 3)
    eq(GH.evaluate(player, tooHigh, addWindow(tooHigh), {cell = cell}).reason,
        "UI_GH_WrongFloor", "floors above the sandbox ceiling are refused")

    local far = addSquare(20, 9, 1)
    eq(GH.evaluate(player, far, addWindow(far), {cell = cell}).reason,
        "UI_GH_TooFar", "out of range windows are refused")

    local noDrop = addSquare(14, 9, 1, {drop = 0})
    eq(GH.evaluate(player, noDrop, addWindow(noDrop), {cell = cell}).reason,
        "UI_GH_NoDrop", "a window without a clear drop is refused")

    local hidden = addSquare(15, 9, 1)
    losBlocked = true
    eq(GH.evaluate(player, hidden, addWindow(hidden), {cell = cell}).reason,
        "UI_GH_OutOfSight", "occluded windows are refused")
    losBlocked = false
end

do -- the cursor is mapped per floor, nearest floor first
    local player = newPlayer(10, 10, 0, 4)
    local lower = addSquare(10, 9, 1)
    addWindow(lower)
    -- Same screen pixel, second floor up: the isometric projection shifts a level
    -- up by three tiles in both axes.
    local upper = addSquare(13, 12, 2)
    addWindow(upper)

    mouseX, mouseY = cursorOver(10, 9, 1)
    local verdict = GH.findTarget(player, mouseX, mouseY, {cell = cell})
    ok(verdict ~= nil, "a target is found under the cursor")
    eq(verdict.z, 1, "the nearest floor above wins")

    lower.window = nil
    squares["10:9:1"] = addSquare(10, 9, 1) -- floor above now has no window
    local higher = GH.findTarget(player, mouseX, mouseY, {cell = cell})
    ok(higher ~= nil, "the search continues to the next floor up")
    eq(higher.z, 2, "second floor above is reached when the first has none")

    squares["13:12:2"].window = nil
    local none, rejected = GH.findTarget(player, mouseX, mouseY, {cell = cell})
    ok(none == nil, "no target when nothing is under the cursor")
    ok(rejected == nil, "no rejection is reported when no window was ever seen")
end

do -- the server breaks first, then spends the ropes
    local player = newPlayer(10, 10, 0, 2)
    local square = addSquare(10, 9, 1)
    local window = addWindow(square)
    local success, reason = GH.execute(player, {x = 10, y = 9, z = 1})
    eq(success, true, "closed window shot succeeds")
    eq(reason, "UI_GH_Attached", "success reason is reported")
    eq(window.smashCalls, 1, "the window is smashed exactly once")
    eq(window.attachCalls, 1, "the rope is tied exactly once")
    eq(window.attachItem, "Base.Rope", "the engine is handed the rope item")
end

do -- rejection never touches the world
    local player = newPlayer(10, 10, 0, 1)
    local square = addSquare(10, 9, 1)
    local window = addWindow(square)
    local success, reason = GH.execute(player, {x = 10, y = 9, z = 1})
    eq(success, false, "shot without enough ropes fails")
    eq(reason, "UI_GH_NeedRopes", "failure reason is forwarded")
    eq(window.smashCalls, 0, "no window is broken on a rejected shot")
    eq(window.attachCalls, 0, "no rope is spent on a rejected shot")
end

do -- an open window is never broken
    local player = newPlayer(10, 10, 0, 2)
    local square = addSquare(10, 9, 1)
    local window = addWindow(square, {climbable = true})
    eq(GH.execute(player, {x = 10, y = 9, z = 1}), true, "open window shot succeeds")
    eq(window.smashCalls, 0, "open window is left intact")
    eq(window.attachCalls, 1, "rope is tied to the open window")
end

do -- the client command path re-validates and answers
    local player = newPlayer(10, 10, 0, 2)
    local square = addSquare(10, 9, 1)
    local window = addWindow(square)
    fireEvent("OnClientCommand", "grappleHook", "fire", player, {x = 10, y = 9, z = 1})
    eq(window.attachCalls, 1, "server command ties the rope")
    eq(#replies, 1, "the server answers the client")
    eq(replies[1].ok, true, "the answer reports success")

    -- Standing right next to the window with plenty of ropes: only the missing
    -- launcher can refuse this shot.
    local cheater = newPlayer(10, 10, 0, 99)
    cheater.primary = otherItem
    local before = #replies
    fireEvent("OnClientCommand", "grappleHook", "fire", cheater, {x = 10, y = 9, z = 1})
    eq(#replies, before + 1, "a rejected command is still answered")
    eq(replies[#replies].ok, false, "a shot without the hook in hand is refused")
    eq(replies[#replies].reason, "UI_GH_Invalid", "the refusal names the missing launcher")
    eq(window.attachCalls, 1, "a shot without the launcher spends no rope")
end

do -- attack interception: registered only while the hook is held
    local player = newPlayer(10, 10, 0, 2)
    addWindow(addSquare(10, 9, 1))
    mouseX, mouseY = cursorOver(10, 9, 1)

    fireEvent("OnPlayerUpdate", player)
    eq(#hookListeners, 1, "the attack hook is registered while the hook is held")
    ok(GH.reticle ~= nil, "the reticle is shown while the hook is held")

    hookListeners[1](player, 1.0, hookItem)
    eq(#queued, 1, "firing with the hook queues the grapple action")
    eq(queued[1].x, 10, "the action keeps the aimed square")

    player.primary = otherItem
    hookListeners[1](player, 1.0, otherItem)
    eq(player.attacks, 1, "a stale registration re-issues the vanilla attack")
    eq(#queued, 1, "a non-hook attack queues nothing")

    -- An off-hand hook cannot be fired, so it must not swallow the swing of the
    -- weapon that is actually in the primary hand.
    player.secondary = hookItem
    hookListeners[1](player, 1.0, otherItem)
    eq(player.attacks, 2, "an off-hand hook lets the primary weapon swing")
    eq(#queued, 1, "an off-hand hook queues no grapple")
    player.secondary = nil

    fireEvent("OnPlayerUpdate", player)
    eq(#hookListeners, 0, "the hook is released when the weapon is put away")
    ok(GH.reticle == nil, "the reticle is hidden when the weapon is put away")
end

do -- no target under the cursor means no action and no vanilla swing
    local player = newPlayer(10, 10, 0, 2)
    fireEvent("OnPlayerUpdate", player)
    mouseX, mouseY = cursorOver(2, 2, 1)
    local before = #queued
    hookListeners[1](player, 1.0, hookItem)
    eq(#queued, before, "firing into empty air queues nothing")
    eq(player.attacks, 0, "firing into empty air does not swing the hook")
end

do -- equip events carry any IsoGameCharacter, not just players
    -- A zombie equipping something must not reach the player-only API; an error
    -- here would abort the event callback inside the engine.
    fireEvent("OnEquipPrimary", {kind = "IsoZombie"}, nil)
    fireEvent("OnEquipSecondary", nil, nil)
    ok(true, "equip events from non-players are ignored instead of erroring")
end

print(string.format("%d checks, %d failures", checks, failures))
if failures > 0 then os.exit(1) end
