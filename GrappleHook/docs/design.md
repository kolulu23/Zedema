# Grapple Hook: product and technical design

Status: normative replacement specification, 2026-09-20. Not a description of
implemented behavior. Engine declarations and unresolved assumptions are recorded
in [engine-contracts.md](engine-contracts.md); test IDs refer to [testing.md](testing.md).

## 1. Product boundary - D01

The player equips a rope launcher, deliberately selects an upper-floor exterior
window, sees its exact material cost and glass warning, confirms a short action,
and receives a native escape rope. Climbing and subsequent rope removal belong
to the game. The launcher does not pull the player or simulate a swinging tether.

First-release support is deliberately bounded:

- Ordinary `IsoWindow` targets on an exterior face, above a stationary, standing
  player on a supported floor; no vehicle, stair, climbing, falling or dead state.
- A loaded, clear launch corridor and a native rope footprint whose bottom is on
  the player's current floor and reachable from the player's exterior position.
- Singleplayer and a dedicated server with two clients are required release modes.
  Local co-op and controller input are not advertised until their separate gates pass.

Defaults are `MaxFloors=2`, `MaxRange=6` horizontal tiles, window breaking enabled,
and launch world-noise radius 15. Proposed supported configuration bounds are
1..4 floors, 1..12 tiles and 0..50 noise radius. Unsupported or non-finite values
are rejected during configuration loading. There is no generic physics or arbitrary
height promise. An engine build that cannot satisfy a contract is not supported.

Non-goals: zombies/players/vehicles as anchors, doors, fences, empty frames,
diagonal/custom window types, dynamic obstacles as targets, crafting/loot balance,
custom rope persistence, player teleportation, or replacing the combat system.

## 2. Interaction and presentation - D02

Use a **non-combat inventory tool**, equipped in the primary hand. Prove the item
class, equipped model and action animation in E01; do not rely on weapon damage
settings. The dedicated launcher action is exposed through an inventory/context
entry and a rebindable aim/confirm control. Normal attack input is never captured,
suppressed, invoked, or replayed by the mod.

Aim mode is per local player. It shows the selected floor, a highlighted window
edge, the rope landing, estimated materials, and a reason when unavailable. Floor
and candidate cycling have explicit bindings. Confirmation uses its own binding
or a UI button, not the ordinary attack binding. Escape cancels. Text/chat focus
prevents hotkeys. If an attack or another activity starts, the launcher action is
cancelled before commitment; the attack itself remains the engine's responsibility.

Preview states are `Unavailable`, `Checking`, `Quoted`, and `Executing`. Use text
and shape as well as color. Only a current server quote enables confirmation.
Selection, movement, equipment change, expiry or configuration change invalidates
that quote. No automatic target switching is allowed after selection or submission.
Freeze quote refresh when the player confirms; late replies cannot replace the
quote bound to the submitted action.

Suggested action duration is 0.65 seconds, measured and enforced by the authority's
validated action lifecycle, not by render frames or a client completion message.
Pause/time acceleration semantics must be measured in E03. No material or world
change occurs while aiming, quoting or winding up. Walk/run, loss of the tool,
incompatible action, death, disconnect or cancellation ends the wind-up.

A cosmetic hook line may be added after correctness gates. It has no collision,
spending or attachment authority. Launch feedback is emitted once per committed
attempt, glass feedback is left to the native window operation, and no client
prediction creates world objects or world noise. Broken-glass hazards and alarms
are not silently removed. The UI distinguishes launch noise from native break noise.

## 3. Target identity and selection - D03

Use the canonical address `{x, y, z, edge}`, with integer square coordinates and
`edge` equal to `N` or `W` in the engine's square-edge convention. An edge is not a
compass direction inferred from a sprite. E02 establishes square ownership,
orientation and exterior-side mapping for every supported facade orientation.

The client explicitly chooses a floor before candidate ranking. The projection
adapter uses the local player's viewport/camera and the selected floor; hard-coded
pixel-to-tile offsets are forbidden. Enumerate only nearby loaded squares, resolve
supported window edges, then rank by screen distance with a stable address tie
break. Show the selected edge even when it is invalid. Cycling selects another
candidate explicitly; invalidity must not cause a jump to a different floor.

The address locates a candidate, not a permanent object identity. On a successful
quote the authority stores a short-lived reference/generation handle to the exact
resolved window and launcher instance. Completion must resolve the address again
and verify those same instances. An object index or matching sprite alone is not
sufficient. Unload/reload or replacement invalidates the quote. Never serialize
Java objects, inventory instances or list indices as trusted network identities.

## 4. Geometry and eligibility - D04

Evaluate four separate predicates: actor/anchor eligibility, launch clearance,
rope footprint, and landing access. Every query returns `CLEAR`, `BLOCKED(reason)`
or `UNKNOWN(reason)`. Only `CLEAR` is acceptable. Missing chunks, unknown enums,
unclassified geometry, ambiguous exterior sides or failed API calls deny the shot.
Do not load or generate distant chunks in response to a client request.

### Launch corridor

Range is horizontal Euclidean distance from the authoritative actor position to
the selected edge's anchor; floor delta is a separate integer restriction. Screen
coordinates never participate in authoritative range or geometry checks.

Use a conservative grid-space corridor from a calibrated launch point on the
player's exterior side to the selected window aperture. E06 records launch/anchor
heights and coordinate units against engine fixtures. No conversion from an
isometric screen displacement to physical height is assumed.

The geometric traversal must enumerate every crossed cell, wall face and floor
plane, including all cells at corner/edge ties (supercover traversal). Read their
collision categories through the engine adapter. Floors, roofs, intervening walls,
closed intermediate windows and unclassified solid contents block. Conservatively
block a whole cell when finer obstacle geometry is unavailable. Do not skip the
origin or destination cell wholesale.

The selected target pane alone may be the terminal obstruction when breaking was
explicitly quoted and remains permitted. Its surrounding wall, barricades and all
intermediate obstructions are still tested. Visibility APIs may supply evidence
or an early rejection; their success alone is not a corridor proof. Any unrecognized
result is `UNKNOWN`, not clear. No general-purpose 3D collision claim is made.

### Rope footprint and usable landing

Before any window mutation, compute the prospective native rope column from the
anchor's exterior side to a supported landing. Check every affected square/edge,
existing rope, obstruction, lower roof/ledge and loading boundary. The landing must
be on the player's floor and have a valid stand/climb approach. Establish access
with a bounded walkability search within the local range region; diagonal corner
cutting and passing through closed doors or other barriers are prohibited.

The engine adapter must match this read-only footprint to the native rope count
and placement semantics. It must be able to preflight a closed window without
opening, smashing or temporarily modifying it. A negative count, unexplained
footprint, unknown landing, or mismatch denies the quote. It is not valid to price
rope as `targetZ - playerZ`.

Reject either-side barricades, existing attachment, invincible glass that would
need breaking, a target occupied by a conflicting window/climb action, prohibited
world regions, or disabled breaking. E07 defines authorization against the
server's protection/safehouse policies; a client cannot supply permission.

## 5. Architecture and execution ownership - D05

Keep a small domain core with adapters, not a new framework:

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Domain policy and geometry | Pure decisions over normalized facts; produce `DeploymentPlan` or reason | Access globals, UI, network or mutate inventory/world |
| Engine read adapter | Resolve actor/window, capture geometry/material facts, project UI coordinates | Change world state while inspecting it |
| Client controller/view | Per-player selection, quote display, action presentation and cleanup | Authorize a shot, debit items, break glass or place rope |
| Authority service | Own quotes/operations; revalidate, serialize commitment and record outcomes | Trust client geometry, cost, identity or completion timing |
| Native action bridge | Map verified B42 action lifecycle into authority admission/completion | Become a second scheduler or world writer |
| Engine writer | Perform the single approved native deployment sequence | Guess success, manually duplicate native debit/replication, or silently recover |

The selected executor is **one custom shared B42 timed action**, following the
verified native lifecycle. Its client presentation/queue completion is not world
commitment. Its authoritative admission and completion enter the authority service.
No parallel fire RPC or custom per-tick shot scheduler exists. E03 must demonstrate
how a server admits the custom action, reconstructs its primitive fields, validates
elapsed duration, cancels it and invokes authoritative completion. These are adapter
contracts, not invented engine callback names. If they cannot be mapped reliably,
the execution design must be revised explicitly before implementation continues.

Folder names are packaging, not security boundaries. Register entrypoints once;
verify a runtime authority predicate in SP, MP client and dedicated server before
installing writers. Keep state by authenticated player/session, never a singleton
local player. Do not register/unregister global combat hooks on equipment changes.

### Quote and command contract

The quote/status transport is read-only with respect to inventory and world state.
Wire envelopes contain a schema version and bounded request identifier. The server
obtains the actor from the authenticated transport or action context, not a supplied
player ID. Wire schema version is 1; unknown fields are rejected. Only plain
bounded data is allowed.

| Message | Client-supplied data | Authority behavior |
| --- | --- | --- |
| `QuoteRequest` | version, requestId, canonical target address | Validate shape/range first, derive all facts, return a quote or stable reason |
| `QuoteResult` | server response only | Contains requestId, quoteId, expiry duration, target, material bill, landing and glass warning |
| Native deploy action | version and quoteId | Admit the quote once for this actor/session, then use the native action lifecycle |
| `StatusRequest` | version, requestId, quoteId | Return current/terminal outcome; never retry deployment |
| `Outcome` | server response only | Correlated state/reason and observed material/world effects |

Each quote is server-issued, bound to the server lifetime, login/character session,
actor, launcher instance, target instance, configuration revision, origin, footprint,
material bill and break decision. Its identifier must be unique and never reused
within that authority lifetime, but secrecy is not the authorization mechanism.
Keep at most one live quote and one admitted operation per actor. An admitted
operation prevents new quotes (`BUSY`); quote refresh replaces only an unadmitted
quote, never an executing operation. Initial quote lifetime: 5 seconds on an
authority-owned monotonic clock, with pause semantics recorded by E03. It must still
be valid at commitment, not merely when queued. Late actions fail without mutation.

Movement input cancels the action. At final validation the actor must also remain
on the bound floor and within a small calibrated idle-position tolerance (initial
proposal: 0.1 tile) of the quoted origin. This accommodates measured idle/network
jitter, not deliberate repositioning. Always recalculate clearance and range from
the current authoritative origin, including movements within that tolerance.

Validate integer coordinates, finite numeric values, enum membership, lengths and
nesting before world lookup. Request and quote identifiers are at most 128 ASCII
characters. Use a fixed schema with no arbitrary nested collections; bound decoded
payload inspection to a 2 KiB logical budget. This is not a promise to intercept raw
packets before the engine decodes them. Quote/status traffic is limited to 4 requests
per second per actor with burst 8, with a server-global geometry-evaluation budget
(initial proposal: 32/second, burst 64). Budget exhaustion rejects work rather than
building an unbounded queue. Malformed or over-budget requests never trigger a scan.

Repeated admission/completion of the same quote cannot create another operation.
Return the recorded state or reject it as consumed. Unknown, expired, evicted or
prior-session quote IDs are never reconstructed from client data. Keep up to 32
terminal records per actor for 120 seconds; eviction only removes status detail.
Authorization requires a matching live quote, so discarded records cannot restore
permission. Reconnection receives a new session. A delayed reply for a previous
selection must not update the current UI.

## 6. Materials and plan - D06

A `DeploymentPlan` is authority-owned data: target and instance handle, origin,
footprint/landing, required materials, break decision, configuration revision and
validation evidence. The client receives only its display-safe quote.

Rope is ammunition. The bill uses the verified native footprint, not floor labels.
Any native fastener consumption must appear as a separate explicit bill entry,
including zero where helpful. The design does not silently require a new material
or assume that nails are free. E04 must establish the exact conditional native bill
and eligible inventory scope before the material policy can be enabled.

Preview inventory and authoritative inventory may differ. Completion must confirm
the exact quoted bill, eligible container scope and still-equipped launcher. Changed
cost means `QUOTE_CHANGED`, no mutation, and a new explicit confirmation. No automatic
inventory transfers occur during the shot. Nested containers are supported only if
native debit and quote counting use the same verified scope; otherwise the UI tells
the player to place materials in the eligible inventory first.

The native operation is the sole material spender. Do not remove ropes in advance,
then call another operation that also removes them. Do not hide nails in another
container, construct a dummy character/inventory, or mint compensating items after
an uncertain failure. Record actual before/after deltas of all relevant materials.

## 7. Commitment, concurrency and failure - D07

Authority states are:

```text
Quoted -> Admitted/WindingUp -> Committing -> Succeeded
   |              |                +-----> FailedPartial / OutcomeUnknown
   +--------------+----------------------> Rejected / Cancelled / Expired
```

Every terminal state is final for that quote. There is no automatic retry.
Cancellation is ordered by the authority: if observed before the transition to
`Committing`, it wins without effects; after that boundary it cannot undo a shot.
A local cancel gesture alone is not proof the authority received it in time.

At admission, check ownership, validity and incompatible activity. At completion,
acquire nonblocking logical guards for the actor, target edge and every affected
rope footprint edge, in canonical order. Guards protect overlapping deployments,
not just two shots at the same window. If busy, reject before mutation. Reentrant
callbacks must see the operation as committing/consumed. Guards are released in an
error-safe finalizer; game actions are never blocked waiting for a long-lived lock.
These guards serialize this mod only, not vanilla actions or other mods. Final
validation and postcondition inspection remain mandatory; incompatible external
mutation must be detected rather than assumed impossible.

Within one non-yielding authority section:

1. Re-resolve and revalidate actor, object instances, origin, permissions, corridor,
   rope footprint, material bill, action duration and configuration. Use current
   facts, not only an equality check on an old snapshot.
2. Mark the operation committing and capture a before-image sufficient to inspect
   window state, inventory counts and affected rope edges.
3. Invoke native window breaking only when explicitly approved and necessary.
   Observe the resulting window state; never toggle it open as a preflight trick.
4. Recheck native attachment eligibility, then invoke native rope attachment once.
   Do not also emit custom replication for effects already owned by the native path.
5. Verify the complete expected rope footprint and exact material delta. A helper's
   boolean return alone is insufficient. Publish and record the observed outcome.

For an already open/broken eligible window, step 3 is absent. For a closed window,
smashing and attaching are separate potentially irreversible engine operations;
there is **no claim of transactional rollback** across them.

| Failure point | Required outcome |
| --- | --- |
| Validation, expiry or cancellation before mutation | No mod-caused glass, noise, item or rope change |
| Window breaks, attachment does not complete | `FailedPartial`; disclose the broken window and observed debit/rope state |
| Partial rope/debit, exception or uninspectable result | `OutcomeUnknown` or `FailedPartial`; quarantine affected edges and deny further mod deployment there |
| Success reply lost | World remains authoritative; status lookup only, no second launch |
| Client leaves during wind-up | Cancel before commitment; release state without spending |
| Client leaves during/after commitment | Complete inspection on the authority; do not undo or replay the operation |

Quarantine is an in-memory safety guard until authoritative inspection/admin repair;
it is not a made-up native rollback API. An uncertain writer result also disables
new deployments for that authority session until inspected. Do not re-enable it
merely because a UI timed out.

Native inventory/map saving is not assumed crash-atomic. The mod never persists or
replays executable requests. A server crash inside native mutation has no claimed
exactly-once recovery guarantee; inspect the loaded native world and use the normal
save-recovery procedure before re-enabling an affected installation. Normal save/load
of completed ropes must pass T27. Durable recovery would require a separate design.

## 8. Lifecycle, persistence and compatibility - D08

State is ephemeral except for native world/inventory effects. On logout, death,
respawn, world change, UI closure or equipment change, clear selection/presentation
and invalidate applicable quotes. Once commitment starts, only the authority may
finalize its record. Never cancel by deleting already placed rope.

On load there are no pending mod operations to resume. The game loads the native
rope, glass and inventory state. Do not store duplicate authoritative rope objects
in mod data. Existing saved native ropes need no mod-specific migration.

Use the public item/mod identifiers stated in the mod README, lowercase new runtime
file paths and repository packaging conventions. Prove model/script/sound references
in game instead of borrowing unrelated combat mechanics. EN/CN text keys must match.
Conflicting geometry or protection mods are unsupported until their adapter
contracts are verified; compatibility must not mean bypassing their restrictions.

## 9. Bounded work and diagnostics - D09

Rendering reads cached preview state and performs no network or world mutation.
Refresh candidates at most 10 Hz while aiming, only on the selected floor and within
the configured local region. Make quote requests only after selection stabilizes,
at most 2 Hz client-side; server limits still apply. Never scan the whole world.

Initial work caps: 512 candidate squares, 256 corridor/footprint cells, and 512
landing-search nodes per evaluation. Exhaustion produces `GEOMETRY_UNSUPPORTED`.
At most one quote and operation per actor, bounded result caches, short-lived object
handles and zero aim scanning while idle make memory/work scale with active users.

Use stable reasons: `UNSUPPORTED_BUILD`, `INVALID_REQUEST`, `RATE_LIMITED`,
`INVALID_ACTOR`, `NO_TOOL`, `OUT_OF_RANGE`, `WRONG_FLOOR`, `TARGET_CHANGED`,
`TARGET_UNSUPPORTED`, `PROTECTED`, `BARRICADED`, `ALREADY_ROPED`,
`BREAK_DISABLED`, `GEOMETRY_BLOCKED`, `GEOMETRY_UNKNOWN`,
`GEOMETRY_UNSUPPORTED`, `LANDING_UNUSABLE`, `MATERIALS_MISSING`,
`QUOTE_CHANGED`, `QUOTE_EXPIRED`, `BUSY`, `CANCELLED`, `ENGINE_FAILURE`,
`FAILED_PARTIAL`, and `OUTCOME_UNKNOWN`. Unknown wire versions are invalid requests;
unknown engine builds are unsupported builds.

Log operation/quote ID, anonymized session-local actor ID, target edge, build,
state transitions, reason, quoted/observed costs, validation time and mutation time.
Do not log credentials or complete inventories. Ordinary rejection logs are
rate-limited; mutation failures are retained prominently.

## 10. Completion criteria - D10

Passing pure logic tests proves the specified logic only. Release requires the
engine contracts, Kahlua/item loading, real native climbing/removal, normal-weapon
non-interference, singleplayer, two-client dedicated-server replication and
adversarial/failure tests in [testing.md](testing.md). No test result is inherited
from a mock, a declaration lookup, or an unexecuted checklist.
