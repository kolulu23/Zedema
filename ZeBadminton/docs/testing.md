# Validation and multiplayer test plan

## Automated

From the repository root: `sh ZeBadminton/tests/run.sh`.
The runner syntax-checks each Lua source and runs simulation, server-command and
client replication tests. Pure Lua mocks are NOT PZ's Kahlua VM or a network stack.
The current host has Lua 5.5.1 with a broken dylib lookup; the runner supplies its
existing library directory locally. No system installation is changed.

## Real engine gate — not run here

No runnable game was found at the repo's standard local/Steam-volume candidate
paths. The decompiled sources are references, not a running game. Do not describe
this prototype as MP-verified until the following matrix is completed.

Install the same `Contents/mods/ZeBadminton` folder under a separate test cache's
`mods/` on a dedicated server and both clients. Preserve the required `common/`
folder. Set `Mods=zeBadminton` in the server test configuration; this unpublished
mod has no Workshop id. Do not invent a WorkshopItems entry. Enable matching mods
on clients. Use separate caches/accounts supported by your installation; do not
reuse a production save. The root deployment script stages a Workshop upload
folder; that alone does not activate a mod for a dedicated server.

Use B42.20.x, two remote clients, a disposable outdoor map area, default time speed,
PVP enabled for a nondamage check, and rackets obtained through the debug/admin
item panel (`Base.TennisRacket`). Capture server and both client console logs and
record exact game build/mod revision. Also run host-and-play separately because
its load paths differ from a dedicated server.

| Scenario | Action | Pass criterion |
| --- | --- | --- |
| Load | Enable mod on dedicated server and clients | No missing require/UI-on-server errors; mod detected |
| Join | A creates; B stands opposite net, refreshes and joins | Both see same court, score 0:0, A serves |
| Rally | Serve, move under shuttle, clear back, then smash/drop | Alternate legal hits; identical score; single ground/net/out point |
| Presentation | Pan camera and change zoom; overlap UI | Court/shadow/height marker track world; buttons and world clicks work |
| Safety | Rally beside a player/zombie; check HP and inventory | Shuttle causes no damage, world sound, item duplication or drops |
| Invalid hits | Unequip racket, stand far away/wrong floor, double-hit | Server rejects; no extra trajectory/score change |
| Lifecycle | Leave, die, disconnect, reconnect, expire lease | Rally clears, slot becomes available; no ghost member/shuttle |
| Discovery | Third client approaches during rally | Discovers court; cannot control it; observer updates every 5 s only |
| Limits | Fill eight courts, attempt overlap/ninth | Creation rejected; existing rallies continue |
| Win | Reach 11, leave/rejoin to begin another match | Finished match cannot serve; fresh pair resets score |
| Load | Eight concurrent rallies for ten minutes | Stable tick cost/memory; no growing orphan sessions |
| Latency | Repeat at 0/100/200 ms RTT, jitter and 1–5% loss | No divergent scores or double hits; record rejection rate |
| Case sensitivity | Load on Linux dedicated server | Exact filenames/require paths work |

Use a controlled network impairment tool between test machines; avoid changing
production networking. Record RTT, jitter, attempted/accepted hits and visual
correction size. MVP has no lag rewind; 200 ms may feel unforgiving. A packet stall
can freeze extrapolation after 150 ms. Long server stalls cap catch-up to 250 ms
per tick, slowing simulation rather than allowing unbounded work. These require
playtesting before tuning shot speed and timing.

## Release gate

Save evidence for each row (builds, reproduction, logs, result). Resolve game-load,
UI projection, client/server serialization and lifecycle failures first. Tune feel
next; introduce assets and animation contact timing after that. Automated passing
results alone do not establish gameplay compatibility or acceptable network feel.
