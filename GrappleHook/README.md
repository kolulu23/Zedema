# Grapple Hook

A handheld grapple launcher for **Build 42**. Fire it at a window on a floor above
you and the hook ties a climbable escape rope to that window — breaking the glass
first when the window is closed. Ropes are the ammunition.

- Workshop item: `GrappleHook/`, mod id `grappleHook`
- Build target: 42.20+ (written against the pinned 42.20.4 decompile in `zombie/`)
- Pure Lua plus one zedscript item; no custom models, animations or audio

## Using it

1. Obtain a grapple hook (`Base.GrappleHook`). Ropes (`Base.Rope`) are the ammo.
2. Equip it in your **primary hand** — the attack input only ever fires the
   primary-hand item.
3. Stand outside below the window you want. Put the cursor on the window one or two
   floors up. The reticle turns green when the shot is valid and shows the cost.
4. Left-click to fire. The hook launches, breaks the window if it has to, and ties
   the rope.
5. Walk to the rope's base and climb it with the vanilla escape-rope action.

## Rules

| Rule | Source |
| --- | --- |
| Window must be 1..`MaxFloors` floors above you | this mod |
| Window must be within `MaxRange` tiles | this mod |
| Window must be unbarricaded | vanilla escape-rope rule (`ISWorldObjectContextMenuLogic`) |
| A rope must be able to hang from it down to a floor | engine, `IsoWindow.countAddSheetRope` |
| Window must not already carry a rope | engine / vanilla menu |
| Closed intact window is smashed by the hook first | engine: `IsoWindow.canClimbThrough` only accepts a rope on a window you can climb through, and that means open or broken |
| Unbreakable (invincible) closed window is refused | engine: `IsoWindow.isInvincible` |
| One `Base.Rope` per level the rope spans (a 2nd-floor window costs 2) | engine: `IsoWindow.addSheetRope`, the same rule the vanilla "Add escape rope" menu uses |
| A nail is spent if you carry one | engine, same as vanilla escape ropes |

## Sandbox options

| Option | Default | Meaning |
| --- | --- | --- |
| `MaxFloors` | 2 | How many floors above the player a shot may reach |
| `MaxRange` | 6.0 | Horizontal range in tiles |
| `BreakWindows` | on | Allow the hook to smash a closed window so the rope can be tied |
| `NoiseRadius` | 15 | World-sound radius of the launch (attracts zombies); 0 is silent |
| `Debug` | off | Log targeting and server decisions to `console.txt` |

## How it works

- **The shot is the mod's, not the engine's.** In Build 42 a bullet is a native
  hitscan owned by `BallisticsController`/`PZBullet` that Lua cannot script and
  cannot replace. The item is therefore a harmless melee weapon (`MinDamage` and
  `MaxDamage` 0, not ranged) and the hook does its own upward raycast.
- **Targeting** maps the cursor into the tile grid of each floor above the player
  with `IsoUtils.XToIso`/`YToIso` (the same isometric projection the game uses,
  which is why one screen pixel means a different tile on each floor), then accepts
  the first window that passes every rule above. Nearest floor wins.
- **Firing** is intercepted with the `Hook.Attack` Lua hook, which the engine calls
  before `DoAttack`. Because `Lua/Event.java` discards the callback result and
  reports "handled" whenever *any* listener is registered, the listener exists only
  while the hook is equipped; a stale registration is repaired by re-issuing the
  attack through `IsoPlayer:AttemptAttack()`, which bypasses the hook.
- **Authority** is the server's. The client sends the aimed square, the server
  re-runs every rule — including that the launcher is really in the player's primary
  hand — then breaks the window (`IsoWindow:smashWindow`) and ties the rope
  (`IsoWindow:addSheetRope`), which spends the rope items and replicates the rope
  objects to clients. Singleplayer uses the same code path in-process.

## Known gaps

- **No custom asset.** The hook has an icon but no weapon model or animation, so it
  renders invisible in hand, and there is no flying-hook visual — only a launch
  sound, the reticle, and the rope appearing. `tools/make_assets.py` generates the
  placeholder icon and posters.
- **Multiplayer is unverified.** The code follows the repository's B42.13+ rule
  (client sends intent, server decides), but it has not been run on a real dedicated
  server with two clients. See `docs/testing.md`.
- **The item script key needs a smoke test.** The 42.20 parser only knows
  `ItemType` (a bare `Type` is silently filed as moddata), which is asserted by the
  test suite, but the vanilla `.txt` files were not available in this workspace to
  cross-check the spelling.
- **Line of sight is classified by enum name.** `LosUtil.lineClear` returns a Java
  enum that is not exposed to Lua, so the result is matched against `"Block"`. If the
  name ever stringifies differently the check fails open (a target behind a wall
  could be offered); everything else is still validated on both sides.

## Development

```sh
sh GrappleHook/tests/run.sh          # luac -p on every source, then lifecycle + static checks

python3 GrappleHook/tools/make_assets.py   # regenerate icon and posters
sh scripts/deploy_workshop.sh GrappleHook   # stage into the local workshop cache
```

- `docs/adr/0001-grapple-hook.md` — design decisions with the decompiled-source
  evidence behind each one
- `docs/testing.md` — automated checks and the real-engine test matrix
