-- Run from the repository root: lua HoldTheDoor/tests/lifecycle.lua
-- Strict, minimal doubles: missing API methods fail rather than silently pass.
local root = "HoldTheDoor/Contents/mods/HoldTheDoor/42/media/lua/"
package.path = root .. "shared/?.lua;" .. root .. "client/?.lua;" .. root .. "server/?.lua;" .. package.path
local clock, client, server, packets, responses = 100, false, false, {}, {}
function getTimestampMs() return clock end
function isClient() return client end
function isServer() return server end
function instanceof(o, name) return o and o.kind == name end
SandboxVars = {HoldTheDoor = {HPMultiplier = 3}}
IsoDirections = {N = "N", S = "S", W = "W", E = "E"}
Events = setmetatable({}, {__index = function(t, k)
    local event = {callbacks = {}}
    function event.Add(f) table.insert(event.callbacks, f) end
    rawset(t, k, event)
    return event
end})
local function fire(name, ...)
    for _, f in ipairs(Events[name].callbacks) do f(...) end
end
IsoDoor = {
    getDoubleDoorIndex = function(d) return d.double and 1 or -1 end,
    getGarageDoorIndex = function(d) return d.garage and 1 or -1 end,
}
local function list(values)
    return {size = function() return #values end, get = function(_, i) return values[i + 1] end}
end
local square = {getX = function() return 10 end, getY = function() return 10 end,
    getZ = function() return 0 end, canStand = function() return true end}
local currentObjects = {}
function square:getObjects() return list(currentObjects) end
local cell = {getGridSquare = function(_, x, y, z)
    if x == 10 and y == 10 and z == 0 then return square end
end}
function getCell() return cell end
local function door(kind)
    local d = {kind = kind or "IsoDoor", hp = 500, data = {}, index = 0}
    function d:getSquare() return self.removed and nil or square end
    function d:getObjectIndex() return self.index end
    function d:getHealth() return self.hp end
    function d:setHealth(n) assert(n == math.floor(n)); self.hp = n end
    function d:getModData() return self.data end
    function d:isDestroyed() return self.destroyed or false end
    function d:IsOpen() return self.open or false end
    function d:isLocked() return self.locked or false end
    function d:isLockedByKey() return self.keylocked or false end
    function d:isBarricaded() return self.barricaded or false end
    function d:isDoor() return true end
    function d:isLockedByPadlock() return self.padlock or false end
    function d:getLockedByCode() return self.code or 0 end
    function d:getNorth() return self.north ~= false end
    function d:getSprite() return {getName = function() return "door" end} end
    function d:transmitModData() self.synced = true end
    function d:sync() self.synced = true end
    currentObjects = {d}
    return d
end
local function player()
    local p = {kind = "IsoPlayer", variables = {}}
    for _, key in ipairs({"Dead", "Asleep", "OnFloor", "KnockedDown", "BumpFall", "SitOnGround", "PlayerMoving", "Aiming"}) do
        p["is" .. key] = function(self) return self[key] or false end
    end
    function p:getVehicle() return nil end
    function p:getCurrentSquare() return self.square or square end
    function p:getPlayerNum() return 0 end
    function p:getX() return 10.5 end
    function p:getY() return 10.5 end
    function p:faceDirection(direction) self.facing = direction end
    function p:clearVariable(key) self.variables[key] = nil end
    function p:shouldBeTurning() return false end
    function p:isIgnoreContextKey() return self.ignore or false end
    function p:setIgnoreContextKey(v) self.ignore = v end
    function p:setBumpType(v) self.bump = v end
    function p:setBumpDone(v) self.bumpDone = v end
    function p:setBumpFall(v) self.BumpFall = v end
    function p:setBumpFallType(v) self.fallType = v end
    function p:reportEvent(v) self.event = v; self.falls = (self.falls or 0) + 1 end
    return p
end
function sendClientCommand(p, module, command, args)
    packets[#packets + 1] = {player = p, command = command, args = args}
end
function sendServerCommand(p, module, command, args)
    responses[#responses + 1] = args
end
ISBaseTimedAction = {}
function ISBaseTimedAction:derive(name)
    local c = {Type = name}; c.__index = c; setmetatable(c, {__index = self}); return c
end
function ISBaseTimedAction:new(p) return setmetatable({character = p}, self) end
function ISBaseTimedAction:stop() self.character.queue = nil; self.anim = nil end
function ISBaseTimedAction:perform() self:stop() end
function ISBaseTimedAction:forceStop() self:stop() end
function ISBaseTimedAction:setOverrideHandModels() self.handsOverridden = true end
function ISBaseTimedAction:setAnimVariable(key, value) self.character.variables[key] = value end
function ISBaseTimedAction:setActionAnim(a)
    -- The real engine captures these when setActionAnim enters the action state.
    self.poseAtAnimationStart = self.character.variables.HoldTheDoorPose
    self.anim = a
end
ISTimedActionQueue = {}
function ISTimedActionQueue.add(a) a.character.queue = a end
function ISTimedActionQueue.clear(p)
    local a = p.queue
    if a then a:stop() end
    p.queue = nil
end
function ISTimedActionQueue.hasAction(a) return a.character.queue == a end
for _, name in ipairs({"ISOpenCloseDoor", "ISLockDoor"}) do
    _G[name] = {isValid = function() return true end,
        complete = function(self) self.executed = true; return true end}
    package.loaded["TimedActions/" .. name] = true
end
package.loaded["TimedActions/ISBaseTimedAction"] = true
package.loaded["TimedActions/ISTimedActionQueue"] = true
require "holdthedoor/authority"
require "holdthedoor/action"
require "holdthedoor/guards"
local H = HoldTheDoor
local count = 0
local function test(name, f)
    client, server = false, false
    for p in pairs(H.sessions) do H.release(p) end
    for p, a in pairs(H.actions) do a:cleanup(); p.queue = nil end
    packets, responses = {}, {}
    f()
    count = count + 1
    print("ok " .. count .. " - " .. name)
end
local function start(p, d)
    local a = ISHoldTheDoor:new(p, d)
    ISTimedActionQueue.add(a); a:start(); return a
end
local function begin(p, d, token) H.command(p, "begin", H.reference(d, token or "test")) end

test("eligible only closed, unlocked, unbarricaded doors", function()
    local d = door(); assert(H.eligible(d))
    for _, key in ipairs({"open", "locked", "keylocked", "barricaded", "destroyed", "double", "garage"}) do
        d[key] = true; assert(not H.eligible(d), key); d[key] = nil
    end
    d.hp = 0; assert(not H.eligible(d))
    d = door("IsoThumpable"); assert(H.eligible(d))
    d.padlock = true; assert(not H.eligible(d)); d.padlock = nil
    d.code = 123; assert(not H.eligible(d))
end)
test("start, animation, input suppression and proportional release", function()
    local p, d = player(), door(); local a = start(p, d)
    assert(a.accepted and a.anim == "HoldTheDoorBrace" and p.ignore and d.hp == 1500)
    d.hp = 900; a:stop()
    assert(d.hp == 300 and not p.ignore and not H.held(d) and not H.sessions[p])
    a:stop(); assert(d.hp == 300)
end)
test("damaged doors gain only proportional health", function()
    local p, d = player(), door(); d.hp = 100; local a = start(p, d)
    assert(d.hp == 300); a:stop(); assert(d.hp == 100)
end)
test("no healing from repeated fractional damage and re-holding", function()
    local p, d = player(), door()
    for _ = 1, 5 do local a = start(p, d); d.hp = d.hp - 1; a:stop() end
    assert(d.hp == 495)
end)
test("only one holder per door, one door per player", function()
    local p, p2, d = player(), player(), door(); begin(p, d)
    begin(p2, d, "second"); assert(not H.sessions[p2] and d.hp == 1500)
    local other = door(); begin(p, other, "other"); assert(other.hp == 500)
end)
test("duplicate begin cannot multiply twice; stale end cannot release", function()
    local p, d = player(), door(); begin(p, d); begin(p, d)
    H.command(p, "end", {token = "old"}); assert(d.hp == 1500 and H.sessions[p])
end)
test("destruction clears action before native fall and never restores HP", function()
    local p, d = player(), door(); local a = start(p, d)
    d.hp = 0; d.destroyed = true; fire("OnObjectAboutToBeRemoved", d); fire("OnTick")
    assert(a.finished and not p.queue and not p.ignore and d.hp == 0 and p.event == "wasBumped" and p.falls == 1)
end)
test("zero HP found in stop still produces one fall", function()
    local p, d = player(), door(); local a = start(p, d); d.hp = 0; a:stop()
    assert(p.falls == 1 and d.hp == 0 and not H.sessions[p])
end)
test("administrative removal releases without falling", function()
    local p, d = player(), door(); local a = start(p, d)
    fire("OnObjectAboutToBeRemoved", d); d.index = -1; fire("OnTick")
    assert(a.finished and not p.event and d.hp == 500)
end)
test("opening, locking, barricading and death cancel without a fall", function()
    for _, key in ipairs({"open", "locked", "barricaded", "Dead"}) do
        local p, d = player(), door(); local a = start(p, d)
        if key == "Dead" then p[key] = true else d[key] = true end
        fire("OnTick"); assert(a.finished and d.hp == 500 and not p.event, key)
    end
end)
test("movement cancels server session even without an end command", function()
    local p, d = player(), door(); start(p, d); p.PlayerMoving = true; fire("OnTick")
    assert(not H.sessions[p] and not p.ignore and d.hp == 500)
end)
test("lease expiry restores disconnected or stalled sessions", function()
    local p, d = player(), door(); begin(p, d); clock = clock + H.lease + 1; fire("OnTick")
    assert(d.hp == 500 and not H.sessions[p])
end)
test("heartbeats extend only matching sessions", function()
    local p, d = player(), door(); begin(p, d)
    clock = clock + 4000; H.command(p, "pulse", {token = "test"})
    clock = clock + 4000; fire("OnTick"); assert(H.sessions[p])
    H.command(p, "pulse", {token = "stale"}); clock = clock + 1001; fire("OnTick"); assert(not H.sessions[p])
end)
test("save ends holds and load repairs orphaned health", function()
    local p, d = player(), door(); start(p, d); d.hp = 900; fire("OnSave")
    assert(d.hp == 300 and not p.ignore)
    d.hp = 900; d.data[H.key] = {original = 500, multiplier = 3}
    fire("LoadGridsquare", square); assert(d.hp == 300 and not H.held(d))
    fire("LoadGridsquare", square); assert(d.hp == 300)
end)
test("loading a square does not restore a live holder", function()
    local p, d = player(), door(); start(p, d); fire("LoadGridsquare", square); assert(d.hp == 1500)
end)
test("shared guards reject open and lock at validation and completion", function()
    local p, d = player(), door(); local a = start(p, d)
    for _, class in ipairs({ISOpenCloseDoor, ISLockDoor}) do
        local action = {character = p, item = d, door = d}
        assert(not class.isValid(action) and not class.complete(action) and not action.executed)
        a:stop(); assert(class.isValid(action) and class.complete(action)); a = start(p, d)
    end
end)
test("remote begin does not mutate client HP; acceptance starts animation", function()
    client = true
    local p, d = player(), door(); local a = start(p, d)
    assert(d.hp == 500 and not a.anim and packets[1].command == "begin")
    H.onReply({token = a.request.token, state = "accepted"}); assert(a.anim and a.accepted)
    a:stop(); assert(packets[#packets].command == "end" and not p.ignore)
    H.onReply({token = a.request.token, state = "released"})
end)
test("cancel before acceptance does not restart animation", function()
    client = true
    local p, d = player(), door(); local a = start(p, d); a:stop()
    H.onReply({token = a.request.token, state = "accepted"})
    assert(not a.anim and not H.actions[p] and packets[#packets].command == "end")
    H.onReply({token = a.request.token, state = "released"})
end)
test("late rejection for old action leaves newer hold intact", function()
    client = true
    local p, d = player(), door(); local old = start(p, d); old:stop(); local new = start(p, d)
    H.onReply({token = old.request.token, state = "rejected"})
    assert(H.actions[p] == new and not new.finished and p.ignore)
    new:stop(); H.onReply({token = new.request.token, state = "released"})
end)
test("pending request times out and restores input", function()
    client = true
    local p, d = player(), door(); local a = start(p, d)
    clock = clock + H.lease + 1; a:update(); assert(a.finished and not p.ignore)
    H.onReply({token = a.request.token, state = "released"})
end)
test("queue replacement watchdog restores input and HP", function()
    local p, d = player(), door(); start(p, d); p.queue = nil; fire("OnTick")
    assert(not H.actions[p] and d.hp == 500 and not p.ignore)
end)
test("malformed and stale network references do not claim a door", function()
    local p, d = player(), door(); local args = H.reference(d, "bad")
    args.index = 0/0; H.command(p, "begin", args); assert(not H.sessions[p])
    args.index = 0; args.sprite = "changed"; H.command(p, "begin", args); assert(not H.sessions[p])
    args.sprite = "door"; args.x = math.huge; H.command(p, "begin", args); assert(not H.sessions[p])
end)
test("adjacency rejects diagonal and wrong-floor players", function()
    local p, d = player(), door()
    p.square = {getX = function() return 9 end, getY = function() return 9 end, getZ = function() return 0 end}
    begin(p, d); assert(not H.sessions[p])
    p.square.getX = function() return 10 end; p.square.getY = function() return 10 end
    p.square.getZ = function() return 1 end; begin(p, d); assert(not H.sessions[p])
end)
test("server sends state and syncs boost and restore", function()
    server = true
    local p, d = player(), door(); begin(p, d)
    assert(d.synced and responses[1].state == "accepted")
    H.release(p); assert(d.hp == 500 and responses[2].state == "released")
end)
test("previous context-key setting survives release", function()
    local p, d = player(), door(); p.ignore = true; local a = start(p, d); a:stop(); assert(p.ignore)
end)
test("north and west doors face correctly from both sides and off-center", function()
    local p, d = player(), door()
    local function at(x, y, z)
        p.square = {getX = function() return x end, getY = function() return y end,
            getZ = function() return z or 0 end}
    end
    for _, offset in ipairs({0.05, 0.5, 0.95}) do
        p.getX = function() return p.square:getX() + offset end
        p.getY = function() return p.square:getY() + offset end
        d.north = true
        at(10, 10); assert(H.face(p, d) and p.facing == "N")
        at(10, 9); assert(H.face(p, d) and p.facing == "S")
        d.north = false
        at(10, 10); assert(H.face(p, d) and p.facing == "W")
        at(9, 10); assert(H.face(p, d) and p.facing == "E")
    end
    at(9, 9); assert(not H.face(p, d))
    at(10, 10, 1); assert(not H.face(p, d))
end)
test("held pose is registered before animation and stays fixed until release", function()
    local p, d = player(), door(); local a = start(p, d)
    assert(a.poseAtAnimationStart == "0.45" and p.variables.HoldTheDoorPose == "0.45")
    for _ = 1, 10 do clock = clock + 1000; a:update() end
    assert(p.variables.HoldTheDoorPose == "0.45" and p.facing == "N")
    a:stop(); assert(p.variables.HoldTheDoorPose == nil)
    local nextAction = start(p, d); assert(nextAction.poseAtAnimationStart == "0.45")
end)
test("late acceptance after movement cannot plant a pose", function()
    client = true
    local p, d = player(), door(); local a = start(p, d)
    p.square = {getX = function() return 20 end, getY = function() return 20 end, getZ = function() return 0 end}
    H.onReply({token = a.request.token, state = "accepted"})
    assert(a.finished and not a.anim and not p.ignore and not p.variables.HoldTheDoorPose)
    H.onReply({token = a.request.token, state = "released"})
end)
test("late destruction stops a newer action before falling", function()
    client = true
    local p, d = player(), door(); local old = start(p, d); old:stop()
    local new = start(p, d)
    H.onReply({token = old.request.token, state = "broken"})
    assert(new.finished and not p.queue and not p.ignore and p.falls == 1)
    H.onReply({token = old.request.token, state = "broken"}); assert(p.falls == 1)
    H.onReply({token = new.request.token, state = "released"})
end)
test("disconnect restores input without sending further packets", function()
    client = true
    local p, d = player(), door(); start(p, d); local sent = #packets
    fire("OnDisconnect"); assert(not p.ignore and not H.actions[p] and #packets == sent)
end)
test("cancel before start never claims a door", function()
    local p, d = player(), door(); local a = ISHoldTheDoor:new(p, d); a:forceCancel()
    assert(d.hp == 500 and not H.sessions[p] and not p.ignore)
end)

local menuPlayer, callbackCalls = nil, 0
function getSpecificPlayer() return menuPlayer end
function getText(key) return key end
ISWorldObjectContextMenu = {setTest = function() return true end}
for _, name in ipairs({"onOpenCloseDoor", "onLockDoor", "onUnLockDoor"}) do
    ISWorldObjectContextMenu[name] = function() callbackCalls = callbackCalls + 1 end
end
ISWalkToTimedAction = {new = function(_, p, target) return {character = p, target = target} end}
package.loaded["ISUI/ISWorldObjectContextMenu"] = true
package.loaded["TimedActions/WalkToTimedAction"] = true
require "holdthedoor/menu"
test("context menu starts and releases a hold; callbacks cannot open or lock", function()
    local p, d = player(), door(); menuPlayer = p
    local context = {options = {}}
    function context:addOption(text, target, callback, arg)
        local option = {text = text, target = target, callback = callback, arg = arg}
        table.insert(self.options, option); return option
    end
    fire("OnFillWorldObjectContextMenu", 0, context, {d, d}, false)
    assert(#context.options == 1)
    local option = context.options[1]; option.callback(option.target, option.arg)
    local action = p.queue; action:start(); assert(H.actions[p] == action)
    ISWorldObjectContextMenu.onOpenCloseDoor({}, d, 0)
    ISWorldObjectContextMenu.onLockDoor({}, 0, d)
    ISWorldObjectContextMenu.onUnLockDoor({}, 0, d)
    assert(callbackCalls == 0 and H.actions[p] == action)
    context.options = {}; fire("OnFillWorldObjectContextMenu", 0, context, {}, false)
    option = context.options[1]; assert(option.text == "ContextMenu_HoldTheDoor_Release")
    option.callback(option.target); assert(not H.actions[p] and d.hp == 500)
    ISWorldObjectContextMenu.onOpenCloseDoor({}, d, 0); assert(callbackCalls == 1)
end)
print("Passed " .. count .. " lifecycle tests")
