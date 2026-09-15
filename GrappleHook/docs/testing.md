# Validation and multiplayer test plan

## Automated

From the repository root: `sh GrappleHook/tests/run.sh`.

It syntax-checks every mod source (`luac -p`), then runs two suites:

- `tests/lifecycle.lua` — strict Lua doubles. Targeting, the rope/window rules, the
  server command path and the attack interception are exercised end to end: nearest
  floor wins, every rejection reason, break-then-tie ordering, the exact item handed
  to the engine, refusals that must not touch the world, and the rule that an
  off-hand hook never swallows another weapon's swing. A missing mock API fails the
  run rather than silently passing.
- `tests/validate.py` — static checks against the pinned references: every
  `:`call exists in the Umbrella stubs, every `Events.*` exists in `events.lua`,
  every `Hook.*` exists in `LuaHookManager.AddEvent`, EN/CN translations have
  identical keys, every `getText` key exists, the item script uses `ItemType` (and
  never a bare `Type`) with zero damage, sandbox options and their translations
  match, and the icon is a 32x32 8-bit palette PNG.

Pure Lua doubles are **not** the Kahlua VM, the engine, or a network stack.

## Real engine gate — not run here

No runnable game was found at the repo's standard local/Steam-volume candidate
paths, so nothing below has been executed in game. The decompiled sources are
references, not a running game.

Install `Contents/mods/GrappleHook` under a test cache's `mods/` (keep the required
`common/` folder), enable it on server and clients, and use a disposable save. Use
B42.20.x, a two-storey building with ordinary windows, and default time speed. Grab
the item from the debug item panel (`Base.GrappleHook`) and `Base.Rope`. Capture
`console.txt` from server and clients, and record the exact game build and mod
revision.

| # | Scenario | Action | Pass criterion |
| --- | --- | --- | --- |
| 1 | Item loads | Open the debug item panel | `Base.GrappleHook` exists with its icon; no `InvalidParameterException` in the log (validates the `ItemType` key) |
| 2 | Reticle | Equip the hook in the primary hand, sweep the cursor | Ticks follow the cursor; text turns green over a valid upstairs window, red with a reason elsewhere |
| 3 | Shot | Aim at a 2nd-floor window from the ground, left-click | Character braces, launch sound plays, rope appears on the window, no bullet/tracer and no swing |
| 4 | Break rule | Aim at the same closed window with 2 ropes | Window breaks (glass sound, shards, alarm if the house has one) and then carries the rope |
| 5 | Open window | Aim at an open window | No break; rope tied directly |
| 6 | Cost | Count ropes before/after a 2nd-floor shot | Exactly 2 `Base.Rope` spent (plus 1 nail if carried), matching the vanilla escape rope |
| 7 | Refusals | Aim at: barricaded / already-roped / invincible / too far / 3rd floor with `MaxFloors = 2` / window behind a wall / window on your own floor | No shot, no break, no rope spent, no error in the log; the reticle explains why |
| 8 | Climb | Walk to the rope base, use the rope | Vanilla rope climb carries the player to the window square; removing the rope still works from the vanilla menu |
| 9 | Other weapons | Hold a bat in the primary hand and the hook in the off-hand; attack | The bat swings normally; no grapple, no swallowed input |
| 10 | Attack passthrough | Equip the hook, then swap to any other weapon and attack repeatedly | Every attack behaves exactly as vanilla; no input eaten (guards the `Hook.Attack` registration rule) |
| 11 | Death / disconnect | Die, respawn, and reconnect while holding the hook | Reticle disappears, attacks still work, no stuck hook listener |
| 12 | Multiplayer | Dedicated server, two clients, PVP on | B sees A's rope appear; exactly one rope set exists; the server log shows the command decision; client inventory matches the server |
| 13 | Multiplayer rejection | Edited client sends a shot without ropes, at an unbreakable window, and out of range | Server refuses all three, answers with a reason, and no window breaks |
| 14 | Latency | Repeat shot/climb at 0/100/200 ms RTT | Rope appears once; no duplicate rope set; climb still works |
| 15 | Linux dedicated server | Load on a case-sensitive filesystem | Exact filenames and require paths work |

## Release gate

Save evidence per row (build, reproduction, logs, result). Resolve game-load,
targeting, rope-cost and multiplayer-authority failures first; only then tune feel
and add the missing assets (weapon model, fire animation, flying-hook visual).
Passing the automated suite does **not** establish gameplay compatibility.
