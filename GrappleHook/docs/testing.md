# Independent acceptance and release tests

Baseline: 2026-09-20. **All execution results are NOT RUN in this documentation
change.** Test IDs are requirements, not assertions of completed coverage.

Use the [design](design.md) as the oracle and [engine contracts](engine-contracts.md)
as the API evidence boundary. Construct fresh fixtures; never assert correctness
because source text contains a particular method, item key, or hook registration.
Static checks may reject violations, but cannot prove behavior.

## Evidence tiers

1. Pure tests: normalized data, policy, geometry, state transitions and bounded work.
2. Adapter contracts: exact API mapping and strict doubles based on measured native
   behavior; throw on unmodeled calls and inject faults at each mutation boundary.
3. Real Kahlua/game: parser/assets, action execution, geometry, native climb/removal.
4. Real multiplayer: dedicated server and two independent clients, with separate
   server/client logs, inventory comparisons and replicated world observations.

Record these separately. A PASS at tier 1 does not become a PASS at tier 3 or 4.

## Acceptance matrix

Every row below has initial status NOT RUN. SP/MP means both release modes.

| ID | Contract | Scenario and required observation |
| --- | --- | --- |
| T01 | D01/D02 | Cold-load the actual item definition, equip/unequip, render icon/model and run action animation without exceptions; preserve item identity |
| T02 | D02/D08 | Attack with normal weapons, launcher in off-hand, launcher in primary hand, and after rapid swaps; the mod never cancels/replays attacks or starts a shot from attack input |
| T03 | D03 | Select each supported floor explicitly; cycle overlapping candidates; invalid candidates never auto-switch to another floor/window |
| T04 | D03/D04 | All four facade orientations and both canonical edge types; corner squares with multiple windows; correct window and exterior rope side every time |
| T05 | D03 | Min/max supported zoom, camera offsets and screen resolutions; stable edge selection and no authoritative dependence on screen coordinates |
| T06 | D04 | Exact range/floor boundaries, negative world coordinates, corner/edge traversal ties; no skipped cell or over-range acceptance |
| T07 | D05 | Trace SP, MP client and dedicated server startup and action lifecycle; one authority writer, no client mutation, no duplicate event installation |
| T08 | D06 | Native bill fixtures at different heights/landings; quoted count equals actual rope debit and complete native footprint, not a floor-delta formula |
| T09 | D06 | Carry zero/one/many nails and ropes; all actual fastener costs appear before confirm; no double debit, hidden material or unrequested transfer |
| T10 | D06 | Main inventory, nested bags, dropped/traded materials and launcher replacement during wind-up; exact scope enforced; changed bill requires a new quote |
| T11 | D01/D07 | Open eligible window: one native rope, no pane break; verify actual climb from landing, exit and native rope removal in SP/MP |
| T12 | D02/D07 | Closed eligible window: warning shown, native break then one attachment; observed alarm/glass/noise semantics correct and not duplicated; glass hazards remain native |
| T13 | D04 | Intervening wall/window, roof, floor slab, overhang, solid contents and tie crossings; blocked paths reject without any mutation |
| T14 | D04 | Barricades on either side, invincible closed glass, existing rope, conflicting window action, wrong exterior side and protected region reject |
| T15 | D04/D09 | Unloaded squares, unknown enum/category, ambiguous geometry, absent landing, blocked walking approach and exhausted budgets reject, never fail open |
| T16 | D05 | Malformed/nested/oversized envelopes, NaN/infinity, wrong types/version, impossible coordinates, forged actor/cost data and bursts; bounded rejection before expensive reads |
| T17 | D05/D06 | Stale quote, changed settings, moved actor, changed footprint or higher material price; zero effects and a precise reason, never silent repricing |
| T18 | D03/D05 | Replace a window or launcher with an otherwise identical instance; unload/reload the target; old quote cannot authorize the replacement |
| T19 | D02/D08 | Walk/run, attack, action replacement, unequip, death and cancel at each pre-commit stage; no material/world effects or stale UI/state |
| T20 | D05/D08 | Disconnect/respawn/reconnect with delayed quote and outcome replies; session ownership resets; no stale action replay or wrong-player UI update |
| T21 | D05/D07 | Duplicate/reordered admission/completion, accelerated client action, direct forged completion and evicted result lookup; at most one committed attempt and no skipped server wind-up |
| T22 | D07 | Two clients shoot one window and different windows with overlapping rope footprints; one compatible commit wins; rejected actor is not charged |
| T23 | D07 | Inject an exception before each mutation, after pane break, during native attach and during inspection; classify no-effect versus partial/unknown accurately |
| T24 | D07 | Force partial rope/debit or an uninspectable return; affected edges quarantined, new writer actions disabled pending inspection, no refund/rollback/retry invented |
| T25 | D05/D07 | Lose/delay the result, then ask status; rope and inventory converge on both clients and late observer; reply loss never causes another attachment |
| T26 | D04/D05 | Authorized versus unauthorized users and supported protection settings; no remote griefing through a forged target or quote |
| T27 | D08 | Complete deployment, save/load and clean server restart; native rope remains climbable and removable, material state persists and no operation resumes |
| T28 | D08/D09 | Repeated equip/aim/cancel and world transitions; state/callback counts stabilize; no idle aim scans, world mutation from render or leaked player references |
| T29 | D09 | Recorded map/hardware and multiple active aimers; measure p50/p95/p99 evaluation and commit durations, read counts and cache bounds; quotas fail closed |
| T30 | D02/D08/D10 | Linux cold-load and path case checks, EN/CN key/format parity, visible text reasons and all advertised controls; optional controller/local co-op verified separately before advertising |

## Required properties

Generate command/action orderings and geometry fixtures to verify:

- Before commitment, rejection/cancellation/expiry leaves inventory, glass and rope
  unchanged by the mod; no world launch noise is emitted.
- A quote authorizes at most one attempted mutation during its authority session.
  Duplicate callbacks and result eviction cannot restore authorization.
- Success implies the complete expected native rope footprint and exactly the
  quoted material debit. Mere helper return values or a visible top segment do not pass.
- New obstructions, unknown cells and tighter range limits cannot convert a rejected
  path into an accepted one with otherwise identical facts.
- Canonical target identity survives coordinate normalization but not instance
  replacement. Selection/late replies never cross actors or selection generations.
- Memory, scan counts and request work stay within configured bounds; terminal
  cleanup cannot cancel another actor's operation.

## Real-engine fixtures and multiplayer procedure

Create a disposable test map/save with north/south/east/west exterior windows,
open/closed/smashed glass, barricades on both sides, corner windows, a lower roof,
blocked and usable landings, a closed intermediate aperture and an unloaded boundary.
Use distinguishable inventories and record exact quantities on server and clients.
Observe the rope bottom, every intermediate segment and the top anchor, then perform
a real climb and removal rather than accepting screenshots as sufficient evidence.

Run MP on a dedicated server with two separate clients; a hosted single-process
session does not replace this test. Start at ordinary time speed; additionally test
pause/acceleration semantics in supported modes. Exercise 0, 100, 200 and 500 ms
RTT, jitter and interrupted connections using available transport/fault tooling.
Replay semantic quote/action callbacks explicitly: a reliable transport does not
make application-level duplicate handling unnecessary.

For failure tests, inject errors at known writer boundaries rather than corrupting
an actual user's save. Record which native changes completed before the failure.
Keep crash-mid-native-mutation recovery distinct from T27: this design does not claim
crash-atomic inventory/map saving or durable operation replay.

## Evidence record template

```text
Test/contract IDs:
Status: NOT RUN | PASS | FAIL | BLOCKED
Executed at (timestamp and timezone):
Tester; OS/hardware:
Game build; Umbrella commit; mod commit:
Mode; server settings; other enabled mods:
Fixture/save description and reproduction steps:
Expected result:
Observed window/rope/material state before and after:
Server/client logs and relevant screenshots:
Measured duration/read counts, where applicable:
Deviation, limitation, and retest reference:
```

Store sanitized evidence under `docs/evidence/` when tests are actually executed.
Do not commit game binaries, decompiled source, player credentials or personal saves.
A future date, empty template, source citation or generated claim is not execution
evidence. Failing cases remain recorded after a fix and link to their retest.

## Release gate

All E01-E10 and required T01-T30 checks must pass at the appropriate evidence tiers
on the exact advertised game build. Required SP and dedicated MP cannot be waived.
Controller/local co-op may remain explicitly unsupported. There must be no unresolved
permission bypass, duplicated effect, incorrect debit, blocked-path acceptance,
unexplained partial mutation, or unsafe item/action lifecycle behavior.

Publish exact supported versions, inventory scope, input modes, conservative geometry
limits and the irreversible-window-break caveat. Performance values must be measured;
no arbitrary timing threshold is presented here as a demonstrated engine capability.
