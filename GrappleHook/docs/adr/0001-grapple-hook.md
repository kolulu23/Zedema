# ADR 0001: A scripted grapple shot, with the engine owning rope and window

Accepted before implementation, 2026-09-14. Evidence is from the pinned references
(`zombie/` = decompiled 42.20.4, `Umbrella/` = tag 42.20.0); no runnable game was
available, so every runtime claim below is marked for the smoke test in
`docs/testing.md`.

## Context

The feature: a handheld grapple that shoots **upwards** at a window on a higher
floor, breaks the window when it is closed, and attaches a **climbable rope** to it,
with existing ropes as ammunition.

The engine question was answered first: Build 42 ballistics are genuinely 3D
(`BallisticsController` posts targets at `z * 2.44949`, muzzle comes from the weapon
bone attachment, a `verticalAimAngle` of -90..+90 exists), so a bullet *can* cross
levels when the ray is unobstructed. But a bullet cannot be turned into a hook:
`CombatManager.fireWeapon` is private and `CombatManager` is not exposed to Lua
(no `@UsedFromLua`), the shot is a hitscan resolved only for the local player
(`SwipeStatePlayer.java:293`, `zombie/CombatManager.java:3616`, `:662-668`), and the
ballistics library is a native JNI binding that is disabled on the server
(`zombie/core/physics/Bullet.java`, `BallisticsController` "Bullet is disabled on
server").

## Decisions

**D1. The shot belongs to the mod.** The item is a harmless melee weapon
(`MinDamage = 0`, `MaxDamage = 0`, not ranged) and the hook runs its own upward
raycast. Consequence: no bullet is spawned, nothing can be damaged by accident, and
the shot's range/geometry are ours to define. Trade-off: the shot cannot use the
native 3D collision, so the rules are explicit checks instead of a physics ray.

**D2. Targeting maps the cursor per floor.** For each floor above the player,
`IsoUtils.XToIso/YToIso(index, mouseX, mouseY, floor)` converts the cursor into that
floor's tile grid (the isometric projection shifts one level by three tiles on both
axes: `zombie/iso/IsoUtils.java:57-99`). The first floor whose window passes all
rules wins, so the shot is aimed, not cycled. Trade-off: the projection makes one
cursor pixel ambiguous between floors; "nearest floor first" is the documented
resolution.

**D3. Interception uses `Hook.Attack`, registered only while equipped.**
`IsoLivingCharacter.AttemptAttack` calls `LuaHookManager.TriggerHook("Attack", ...)`
and returns before `DoAttack` when it reports handled
(`zombie/characters/IsoLivingCharacter.java:37-53`). Critically, `zombie/Lua/Event.java`
runs callbacks with `protectedCallVoid` and returns `true` whenever the callback list
is non-empty (`Event.java:26-70`), so *any* listener cancels *every* attack for that
character regardless of its return value. Therefore the listener is added on equip
and removed on unequip, and a stale registration is repaired by re-issuing the attack
through `IsoPlayer:AttemptAttack()` (`zombie/characters/IsoPlayer.java:5762`), which
calls `DoAttack` directly and never passes through the hook. Attacks made with any
other weapon are likewise re-issued, and the hook only hijacks the item the engine
reports (`leftHandItem` = `getPrimaryHandItem()`, `IsoGameCharacter.java:3685`).

**D4. Ropes are the ammunition, priced by the engine's own rule.**
`IsoWindow.addSheetRope(player, itemType)` creates the rope objects one level at a
time and removes one `itemType` per iteration, plus one `Nails` item when the player
has one (`zombie/iso/objects/IsoWindow.java:945-1036`); `countAddSheetRope` returns
that level count (`:883-933`). The vanilla context menu prices escape ropes the same
way (`zombie/iso/ISWorldObjectContextMenuLogic.java:2760-2791`, using `Rope` or
`SheetRope`). Using the engine routine means the spent rope *is* the hanging rope, the
cost matches vanilla, and removal/climbing/crafting stay consistent.

**D5. Break the window only when the engine demands it.**
`IsoWindow.canClimbThrough` returns `health > 0 && !destroyed ? open : true`
(`zombie/iso/objects/IsoWindow.java:139-152`), and `canAddSheetRope()` requires
`canClimbThrough` (`:931-938`). So a closed intact window cannot take a rope and a
broken one can — exactly the requested "break it if it is closed" behaviour, with the
"breakable" test being `isInvincible()`. `smashWindow(bRemote, doAlarm)` already
handles the client→server packet, the sound, the shards and the house alarm
(`zombie/iso/objects/IsoWindow.java:280-322`), so no custom glass logic exists.
Barricaded windows are refused, matching the vanilla menu.

**D6. Server authority, client intent.** The client sends only the aimed square
(`{x, y, z}`); `GH.execute` re-runs every rule server-side before breaking or tying —
including that the launcher is really in the player's primary hand, which a client
cannot fake — and answers with a reason. `addSheetRope` runs on the server so the item removal is
authoritative (`GameServer.sendRemoveItemsFromContainer`) and the rope objects
replicate (`transmitCompleteItemToClients` → `AddItemToMap`,
`zombie/iso/IsoObject.java:4770-4778`). Singleplayer runs the same function
in-process (`isClient()` is false there).

**D7. `ItemType`, not `Type`, in the item script.** `zombie/scripting/objects/Item.java`
parses `ItemType` (`:2453`); a bare `Type` matches no parser branch in the tree, is
silently stored as moddata (`:3466-3488`) and leaves the item without a class, which
throws when instantiated (`:2306`). This contradicts the widely known `Type = Weapon`
spelling, so it is asserted by `tests/validate.py` and flagged for the smoke test.

## Consequences

- The mod is entirely Lua + one script block: no native code, no new asset pipeline.
- The rope, the break, the climb and the alarm are vanilla behaviour, so climbing
  uses `IsoPlayer:canClimbSheetRope` and the vanilla rope-removal menu for free.
- Unverified until played: the `ItemType` spelling, the launch sound name
  (`AttackShove`, chosen because the engine itself references it), the enum-name
  classification of `LosUtil.lineClear`, and the multiplayer round trip.
- No custom model/animation yet: the launcher reuses a vanilla model
  (`StaticModel = Base.Crowbar`) because a Weapon with a null StaticModel crashes in
  `ModelManager.addEquippedModelInstance` when held (first play test, 2026-09-25);
  the shot has no flying-hook visual.
