# Engine contract and evidence register

Baseline: 2026-09-20. **Runtime verification: NOT RUN.** This review did not have
access to a runnable Project Zomboid installation, exact-build decompile, or
dedicated-server session. Declared APIs were inspected; behavior was not executed.

## Reference lock

The repository [API pin](../../.api-refs.json) records game **42.20.4**, Umbrella
**42.20.0**, commit `98f50ae698aab1dc7c44ba4fba87c33c800fee20`. Keep the pin and
submodule consistent. Do not resolve `latest` during this implementation. The
42.20.0 stub / 42.20.4 runtime difference is a verification obligation, not proof
that every declaration matches the installed game.

The root [AGENTS.md](../../AGENTS.md) governs workspace packaging. Installed vanilla
scripts and a locally generated decompile of the exact tested build must settle
behavioral questions. Official online JavaDocs are supplementary and unversioned;
they cannot replace an exact-build check.

## Inspected declarations

These are primary reference artifacts from their maintainers, not behavior tests:

| Ref | Observed declaration | What it does not prove |
| --- | --- | --- |
| U1 | `IsoWindow` exposes instance and static rope count/add/eligibility methods, orientation, barricade/window state, and smash overloads | Cost, eligible containers, closed-window preflight, rollback, networking or alarm behavior |
| U2 | Shared `ISAddSheetRope` declares `complete`, `perform`, `getDuration`, validation and lifecycle methods | Which context invokes each method or whether a custom action serializes safely |
| U3 | Shared `ISBaseTimedAction` declares a network-action field, duration, validation, cancellation and presentation methods | Trusted server admission, elapsed-time enforcement or delivery guarantees |
| U4 | `LosUtil` exposes line/collision queries returning several types, including `LosUtil.TestResults` | That one query proves complete cross-floor projectile or rope clearance |
| U5 | `IsoUtils` exposes floor-aware projection and player-index overloads | Correct viewport/camera scaling for every supported input layout |
| U6 | `ModelScript` exposes mesh/texture/shader names, static classification and attachment lookup | Script-key grammar, FBX axis/scale conventions or held rendering for a non-combat item |
| U7 | `ModelAttachment` exposes bone, offset, rotation and scale data | Blender Empty import, required grip/socket IDs or a composed world-space muzzle transform |
| U8 | Client `ISUIElement` declares textured lines, lines and polygons | World depth testing, roof/fog occlusion or a free-flight 3D model renderer |
| U9 | `BaseSoundEmitter` declares playback, position, individual sound handles and stop operations | Whether a chosen overload rebroadcasts, emits world noise, or shares lifetime with other actions |

Sources: [U1][u1], [U2][u2], [U3][u3], [U4][u4], [U5][u5], [U6][u6], [U7][u7],
[U8][u8], [U9][u9]. Supplementary official documentation: [IsoWindow][j1],
[LosUtil][j2], [LosUtil.TestResults][j3], checked 2026-09-20. See
[custom-assets.md](custom-assets.md) for the authoring references and illustrative
registration templates. No availability or semantic inference beyond these tables
is accepted from a source link alone.

## Mandatory executable contracts

Every row starts **NOT RUN**. Fill evidence, not an assertion, before changing it.

| ID | Required proof and artifact | Failure policy | Tests |
| --- | --- | --- | --- |
| E01 | Load the launcher using the actual build's item parser; equip a non-combat tool with valid icon/model; play a supported action animation without a swing, shove or unintended attack effect. Record vanilla script references and tested identifiers. | Block the item shell; do not guess parser keys or use a weapon as a shortcut | T01, T02 |
| E02 | Establish canonical square/edge ownership, exterior side, same-instance comparison, actor origin and viewport projection for all four facade orientations. Replace/unload a target and verify invalidation. | Disable unproven target types/orientations | T03-T06, T18 |
| E03 | Trace the actual custom shared timed-action lifecycle in SP and dedicated MP: serialization of quoteId, authenticated actor, server admission, timing, cancellation, completion, duplicate callbacks and client queue cleanup. Produce a context/callback trace and exact runtime authority truth table, including monotonic quote time versus game-time action duration. | Block execution architecture; never add a second fire RPC or trust a client timer | T07, T16, T19-T21 |
| E04 | With native fixtures, measure rope count, all material debits including nails, container scope, item-type argument spelling, already-roped behavior and closed-window read-only preflight. Compare the predicted footprint with actual affected edges. | Block quoting/attachment if an exact bill and footprint cannot be proven | T08-T10, T17 |
| E05 | Execute window break and native attach from the approved authority context; measure glass, alarm, noise, partial failure, inventory mutation and propagation to both clients. Verify no additional manual debit/packets are needed. | Block that engine build or mode; no guessed replication/rollback | T11, T12, T22-T25 |
| E06 | Calibrate corridor coordinates and classify relevant cells/edges/floors from actual APIs. Exercise roofs, intervening windows/walls, corners and unknown values. Prove supported conservative clearance and landing walkability. | Unknown geometry rejects; do not relax checks to increase acceptance | T04-T06, T13-T15 |
| E07 | Verify server region/safehouse/protection permission checks for remote window mutation and rope placement. Test an authorized and unauthorized actor. | Refuse protected/unknown policy regions; block claimed compatibility if policy cannot be enforced | T14, T26 |
| E08 | Verify disconnect, respawn, world reload, action interruption, committed rope save/load and observer convergence after reconnect. | Block release on stale actions, missing ropes or replay | T19, T20, T27 |
| E09 | Verify startup registration and runtime authority guards across client/server/shared load contexts; no combat hooks or duplicated event installation. | Disable the feature on a context mismatch | T02, T07, T28 |
| E10 | Measure bounded scans, quote dispatch, memory cleanup and non-aim idle work on recorded hardware/build. Validate EN/CN, Linux paths and optional input modes independently. | Reduce advertised support or fix budgets before release | T28-T30 |
| E11 | Probe custom FBX and PNG loading, exact script keys/resource resolution, non-combat held rendering, grip/ground transforms and required folder case. Record Blender/exporter version, profile, measured transforms and production-asset hashes. | Block shipping custom item presentation; do not switch to a combat item or guess offsets | T31-T33, T37 |
| E12 | Prove native action pose and hand-model override restoration on interruption, death and world transition. For any custom clip, prove skeleton mapping, clip registration, transitions and SP/MP pose behavior without animation-owned mutation. | Retain only a tested native pose; optional clips remain disabled until scoped evidence passes | T19, T20, T33, T38 |
| E13 | Prove file-based custom sound loading and local playback ownership, separate authoritative world noise, fresh-outcome dedup, render projection/visibility, resource cleanup and effect-disabled equivalence. Exact muzzle/world rendering requires its own proof if enabled. | Disable unproven optional accents; block release for gameplay coupling, duplicate noise or unreadable baseline feedback | T34-T38 |

E11-E13 have a calibration/probe phase and a final production-integration phase.
A probe pass is not acceptance of the finished mesh, clip or sound. Optional
skeletal animation, world-space flight and remote custom presentation must be
listed as enabled or excluded; excluded features do not receive a PASS or a
compatibility claim. Baseline static item, action restoration and local feedback
contracts remain required.

## How to collect evidence

Use a disposable save. Record the exact executable version, reference commit,
vanilla script hashes, operating system, enabled mods, server settings and mod
revision. Store a minimal fixture description, numbered reproduction steps,
expected observations, actual observations and relevant timestamped logs. Capture
before/after material counts and rope/window state, not only a screenshot of a rope.

For assets, add source/output hashes, exporter version/settings, attachment
transforms, shader/material assumptions and tested animation/sound identifiers.
Capture the actual equipped, ground and inventory presentations. Separate an
artist's source render from an executed in-game observation.

Inspect native implementation details locally where needed; do not redistribute
game source or treat an unrelated third-party decompile as exact-build evidence.
A stub supplies names; native source supplies a hypothesis; an executed fixture
establishes the supported behavior. Record contradictory observations explicitly.

A contract may be `NOT RUN`, `PASS`, `FAIL`, or `BLOCKED`, with an evidence link.
There is no implicit PASS. Pure tests, mocked adapters, source inspection and real
engine tests must appear as separate evidence categories.

[u1]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/iso/objects/IsoWindow.lua
[u2]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/lua/shared/TimedActions/ISAddSheetRope.lua
[u3]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/lua/shared/TimedActions/ISBaseTimedAction.lua
[u4]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/iso/LosUtil.lua
[u5]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/iso/IsoUtils.lua
[u6]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/scripting/objects/ModelScript.lua
[u7]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/scripting/objects/ModelAttachment.lua
[u8]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/lua/client/ISUI/ISUIElement.lua
[u9]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/audio/BaseSoundEmitter.lua
[j1]: https://projectzomboid.com/modding/zombie/iso/objects/IsoWindow.html
[j2]: https://projectzomboid.com/modding/zombie/iso/LosUtil.html
[j3]: https://projectzomboid.com/modding/zombie/iso/LosUtil.TestResults.html
