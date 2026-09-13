ZeBadminton = ZeBadminton or {}
local B = ZeBadminton
B.module, B.version = "zebadminton", 1
B.step, B.drag, B.gravity = 1 / 60, 0.35, 9.8
B.shots = {clear = {time = 1.8, depth = 5}, smash = {time = 0.65, depth = 4}, drop = {time = 1.1, depth = 2}}
function B.finite(n) return type(n) == "number" and n == n and math.abs(n) < 10000000 end
function B.inside(c, p, margin)
    margin = margin or 0
    return p.z == c.z and p.x >= c.x - margin and p.x <= c.x + 6 + margin
        and p.y >= c.y - margin and p.y <= c.y + 14 + margin
end
function B.side(c, y) return y < c.y + 7 and 1 or 2 end
function B.newCourt(id, p)
    return {id = id, x = math.floor(p.x) - 3, y = math.floor(p.y) - 13, z = p.z,
        players = {}, score = {0, 0}, server = 2, phase = "waiting", revision = 0, event = "created"}
end
function B.member(c, id)
    for side = 1, 2 do if c.players[side] == id then return side end end
end
function B.point(c, winner, reason)
    c.score[winner] = c.score[winner] + 1
    c.server, c.shuttle, c.lastHit = winner, nil, nil
    c.phase = c.score[winner] >= 11 and "finished" or "ready"
    c.event = reason
end
function B.launch(c, p, side, shot, lane, serving)
    local profile = B.shots[shot]
    if not profile or (lane ~= -1 and lane ~= 0 and lane ~= 1) then return false, "invalid shot" end
    if not B.inside(c, p) or B.side(c, p.y) ~= side then return false, "stand in your half" end
    if not c.players[1] or not c.players[2] then return false, "waiting for opponent" end
    local s = c.shuttle
    if serving then
        if c.phase ~= "ready" or c.server ~= side then return false, "not your serve" end
        s = {x = p.x, y = p.y, h = 1.3}
        profile, shot = B.shots.clear, "clear"
    else
        if c.phase ~= "rally" or not s or c.lastHit == side then return false, "not your return" end
        if B.side(c, s.y) ~= side then return false, "shuttle is across the net" end
        if (s.x - p.x)^2 + (s.y - p.y)^2 > 2.2^2 or s.h < 0.25 or s.h > 3.1 then
            return false, "out of reach"
        end
        if shot == "smash" and s.h < 1.8 then return false, "smash needs a high shuttle" end
    end
    local tx = c.x + 3 + lane * 2
    local ty = c.y + 7 + (side == 1 and profile.depth or -profile.depth)
    local t = profile.time
    local factor = B.drag / (1 - math.exp(-B.drag * t))
    s.vx, s.vy = (tx - s.x) * factor, (ty - s.y) * factor
    s.vh, s.age = (0.5 * B.gravity * t * t - s.h) / t, 0
    c.shuttle, c.lastHit, c.phase, c.event = s, side, "rally", shot
    return true
end
-- Exact linear horizontal drag and ballistic vertical integration.
function B.advance(s, dt)
    local decay = math.exp(-B.drag * dt)
    s.x = s.x + s.vx * (1 - decay) / B.drag
    s.y = s.y + s.vy * (1 - decay) / B.drag
    s.h = s.h + s.vh * dt - 0.5 * B.gravity * dt * dt
    s.vx, s.vy, s.vh = s.vx * decay, s.vy * decay, s.vh - B.gravity * dt
    s.age = s.age + dt
end
function B.tick(c, dt)
    local s = c.shuttle
    if not s then return false end
    local x, y, h = s.x, s.y, s.h
    B.advance(s, dt)
    local net = c.y + 7
    if (y < net and s.y >= net) or (y > net and s.y <= net) then
        local f = (net - y) / (s.y - y)
        if h + (s.h - h) * f <= 1.55 then B.point(c, 3 - c.lastHit, "net fault"); return true end
    end
    if s.h <= 0 then
        local f = h / (h - s.h)
        local landing = {x = x + (s.x - x) * f, y = y + (s.y - y) * f, z = c.z}
        local winner = B.inside(c, landing) and (3 - B.side(c, landing.y)) or (3 - c.lastHit)
        B.point(c, winner, B.inside(c, landing) and "ground" or "out")
        return true
    end
    if s.age > 8 then B.point(c, 3 - c.lastHit, "timeout"); return true end
    return false
end
return B
