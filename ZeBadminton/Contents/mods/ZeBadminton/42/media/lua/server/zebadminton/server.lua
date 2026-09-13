require "zebadminton/core"
if isClient() then return end
local B = ZeBadminton
local courts, peers, nextId = {}, {}, 0
B.courts = courts
local function now() return getTimestampMs() / 1000 end
local function identity(p) return p:getUsername() end
local function position(p) return {x = p:getX(), y = p:getY(), z = p:getZ()} end
local function equipped(p)
    local item = p:getPrimaryHandItem()
    return item and item:getFullType() == "Base.TennisRacket"
end
local function send(p, command, data)
    if isServer() then sendServerCommand(p, B.module, command, data)
    elseif B.receive then B.receive(command, data) end
end
local function snapshot(c)
    -- Only primitives and tables cross the network; copy mutable physics state.
    local s = {version = B.version, id = c.id, x = c.x, y = c.y, z = c.z,
        revision = c.revision, phase = c.phase, server = c.server,
        score = {c.score[1], c.score[2]}, players = {c.players[1] or "", c.players[2] or ""}, event = c.event}
    if c.shuttle then
        s.shuttle = {}
        for k, v in pairs(c.shuttle) do s.shuttle[k] = v end
    end
    return s
end
local function publish(c)
    c.revision = c.revision + 1
    for _, id in pairs(c.players) do
        local peer = peers[id]
        if peer then send(peer.player, "state", snapshot(c)) end
    end
end
local function leave(id)
    local peer = peers[id]
    local c = peer and courts[peer.court]
    if not c then return end
    c.players[B.member(c, id)] = nil
    peer.court = nil
    c.shuttle, c.lastHit, c.phase, c.event = nil, nil, "waiting", "player left"
    publish(c)
    send(peer.player, "left", {id = c.id})
    if not c.players[1] and not c.players[2] then courts[c.id] = nil end
end
local function discover(p)
    local list, pos = {}, position(p)
    for _, c in pairs(courts) do
        if B.inside(c, pos, 35) then list[#list + 1] = snapshot(c) end
    end
    send(p, "list", {version = B.version, courts = list})
end
function B.command(p, command, a)
    if not p or type(a) ~= "table" or a.version ~= B.version then return end
    local id, t = identity(p), now()
    local peer = peers[id]
    if not peer or peer.player ~= p then
        if peer then leave(id) end
        peer = {player = p, sequence = 0, tokens = 20, refill = t, seen = t}
        peers[id] = peer
    end
    peer.tokens = math.min(20, peer.tokens + math.max(0, t - peer.refill) * 10)
    peer.refill = t
    if peer.tokens < 1 then return end
    peer.tokens = peer.tokens - 1
    if not B.finite(a.sequence) or a.sequence % 1 ~= 0 or a.sequence <= peer.sequence then return end
    peer.sequence, peer.seen = a.sequence, t
    local function reject(reason) send(p, "notice", {text = reason}) end
    if command == "list" then discover(p); return end
    if command == "leave" then leave(id); return end
    if command == "pulse" then return end
    if p:isDead() or not equipped(p) then reject("Equip a tennis racket first"); return end
    local pos = position(p)
    if command == "create" then
        if peer.court then reject("Leave your current court first"); return end
        local count = 0
        for _ in pairs(courts) do count = count + 1 end
        if count >= 8 then reject("Court limit reached"); return end
        local c = B.newCourt(nextId + 1, pos)
        for _, other in pairs(courts) do
            if c.z == other.z and math.abs(c.x - other.x) < 10 and math.abs(c.y - other.y) < 18 then
                reject("Too close to another court"); return
            end
        end
        -- Loaded, outdoor, standable tiles only. Trees/walls still require manual inspection.
        for x = c.x, c.x + 5 do for y = c.y, c.y + 13 do
            local square = getCell():getGridSquare(x, y, c.z)
            if not square or not square:isOutside() or not square:isFree(false) then
                reject("Court needs a clear loaded outdoor 6 x 14 area north of you"); return
            end
        end end
        nextId = c.id
        courts[c.id], c.players[2], peer.court = c, id, c.id
        publish(c); discover(p)
        return
    end
    if not B.finite(a.id) then return end
    local c = courts[a.id]
    if command == "join" then
        if peer.court or not c or not B.inside(c, pos) then reject("Stand in an available court"); return end
        local side = B.side(c, pos.y)
        if c.players[side] then reject("Stand on the empty half"); return end
        c.players[side], peer.court = id, c.id
        c.score, c.server, c.phase, c.event = {0, 0}, 2, "ready", "joined"
        publish(c); return
    end
    if not c or peer.court ~= c.id then return end
    local side = B.member(c, id)
    if command == "serve" or command == "hit" then
        if t - (peer.hit or -100) < 0.25 then return end
        peer.hit = t
        local accepted, reason = B.launch(c, pos, side, a.shot, a.lane, command == "serve")
        if accepted then publish(c) else reject(reason) end
    end
end
Events.OnClientCommand.Add(function(module, command, player, args)
    if module == B.module then B.command(player, command, args) end
end)
local last, accumulator, broadcast = now(), 0, 0
Events.OnTick.Add(function()
    local t = now()
    accumulator = accumulator + math.max(0, math.min(t - last, 0.25))
    last = t
    for id, peer in pairs(peers) do
        local c = courts[peer.court]
        if peer.player:isDead() or t - peer.seen > 12 or (c and not B.inside(c, position(peer.player), 3)) then
            leave(id); peers[id] = nil
        end
    end
    while accumulator >= B.step do
        for _, c in pairs(courts) do if B.tick(c, B.step) then publish(c) end end
        accumulator = accumulator - B.step
    end
    if t - broadcast >= 0.1 then
        broadcast = t
        for _, c in pairs(courts) do if c.shuttle then publish(c) end end
    end
end)
