require "holdthedoor/core"
require "TimedActions/ISBaseTimedAction"
require "TimedActions/ISTimedActionQueue"
local H = HoldTheDoor
local pending, serial = {}, 0
ISHoldTheDoor = ISBaseTimedAction:derive("ISHoldTheDoor")

local function send(action, command)
    if isClient() then sendClientCommand(action.character, H.module, command, action.request)
    else H.command(action.character, command, action.request) end
end

function ISHoldTheDoor:isValid()
    if self.finished then return false end
    -- In MP the server decides whether a disappearing object broke or was
    -- removed. Do not infer a knockdown from replication order on the client.
    return H.fit(self.character) and H.eligible(self.door)
        and H.adjacent(self.character, self.door)
        and (not H.actions[self.character] or H.actions[self.character] == self)
        and (self.request ~= nil or not H.held(self.door))
end

function ISHoldTheDoor:waitToStart()
    if not self:isValid() then return false end
    H.face(self.character, self.door)
    return self.character:shouldBeTurning()
end

function ISHoldTheDoor:start()
    if not self:isValid() then self:forceStop(); return end
    serial = serial + 1
    self.request = H.reference(self.door, tostring(getTimestampMs()) .. ":" .. tostring(serial))
    self.startedAt, self.lastPulse = getTimestampMs(), getTimestampMs()
    self.oldContextKey = self.character:isIgnoreContextKey()
    self.character:setIgnoreContextKey(true)
    H.actions[self.character] = self
    pending[self.request.token] = self
    send(self, "begin")
end

function ISHoldTheDoor:update()
    if self.finished then self:forceStop(); return end
    local now = getTimestampMs()
    if not self.accepted and now - self.startedAt > H.lease then self:forceStop(); return end
    H.face(self.character, self.door)
    self.character:setIgnoreContextKey(true)
    if now - self.lastPulse >= 1000 then
        self.lastPulse = now
        send(self, "pulse")
    end
end

function ISHoldTheDoor:cleanup()
    if self.finished then return end
    self.finished = true
    if H.actions[self.character] == self then
        H.actions[self.character] = nil
        self.character:setIgnoreContextKey(self.oldContextKey)
        self.character:clearVariable("HoldTheDoorPose")
    end
    if self.request then
        self.closedAt = getTimestampMs()
        send(self, "end")
    end
end

function ISHoldTheDoor:stop()
    self:cleanup()
    ISBaseTimedAction.stop(self)
end

function ISHoldTheDoor:perform()
    self:cleanup()
    ISBaseTimedAction.perform(self)
end

function ISHoldTheDoor:forceCancel() self:cleanup() end
function ISHoldTheDoor:isUsingTimeout() return false end
function ISHoldTheDoor:getDuration() return -1 end

function ISHoldTheDoor:new(player, door)
    local o = ISBaseTimedAction.new(self, player)
    o.door, o.maxTime, o.loopedAction, o.useProgressBar = door, -1, true, false
    o.stopOnWalk, o.stopOnRun, o.stopOnAim = true, true, true
    return o
end

function H.onReply(args)
    if type(args) ~= "table" then return end
    local action = pending[args.token]
    if not action then return end
    if args.state == "accepted" then
        if action.finished then send(action, "end"); return end
        if not action:isValid() then action:forceStop(); return end
        if not action.accepted then
            action.accepted = true
            H.face(action.character, action.door)
            action:setOverrideHandModels(nil, nil)
            -- AnimationTrack reads this normalized clip position each frame.
            -- Register it BEFORE setActionAnim: B42 snapshots action variables
            -- when entering PlayerActionsState, including for remote observers.
            action:setAnimVariable("HoldTheDoorPose", "0.45")
            action:setActionAnim("HoldTheDoorBrace")
        end
        return
    end
    pending[args.token] = nil
    if not action.finished then
        -- Cleanup the Java action immediately before entering a fall state.
        ISTimedActionQueue.clear(action.character)
        action:cleanup()
    end
    if args.state == "broken" and not action.fell and not action.character:isDead() then
        action.fell = true
        local player = action.character
        -- A terminal packet may arrive after local cancellation and the start
        -- of another action. That action must also stop before the fall.
        ISTimedActionQueue.clear(player)
        player:setBumpType("stagger")
        player:setBumpDone(false)
        player:setBumpFall(true)
        player:setBumpFallType("pushedFront")
        player:reportEvent("wasBumped")
    end
end

Events.OnServerCommand.Add(function(module, command, args)
    if module == H.module and command == "state" then H.onReply(args) end
end)

Events.OnTick.Add(function()
    -- Covers death, replacement by another action, and queue resets which do
    -- not call stop() on an already-started Lua action.
    for player, action in pairs(H.actions) do
        if not H.fit(player) or not ISTimedActionQueue.hasAction(action) then action:cleanup() end
    end
    for token, action in pairs(pending) do
        if action.closedAt and getTimestampMs() - action.closedAt > H.lease * 3 then pending[token] = nil end
    end
end)

Events.OnDisconnect.Add(function()
    for player, action in pairs(H.actions) do
        action.finished = true
        player:setIgnoreContextKey(action.oldContextKey)
        player:clearVariable("HoldTheDoorPose")
        H.actions[player] = nil
    end
    pending = {}
end)
