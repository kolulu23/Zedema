# Fresh implementation plan

Status: planned; no work package below is claimed complete. Implement the
[design](design.md), not a repair or port of an implementation. The authoritative
inputs are product contracts, the pinned engine, executable engine evidence and
new independent fixtures. Do not import runtime modules or treat existing tests as
expected behavior.

## Dependencies

```text
P0 engine feasibility
  -> P1 pure specification/model
  -> P2 item/action shell
  -> P3 read-only targeting/quoting
  -> P4 authoritative deployment
  -> P5 MP/failure hardening
  -> P6 presentation/release
```

The sequence above is dependency order, not a calendar. P1 pure fixtures may be
drafted while P0 runs. No engine-bound implementation may assume a failed or
unresolved P0 contract. P4 requires P1-P3; P6 requires P5. A failed gate is a design
decision to resolve, not permission to add a fallback path.

## P0 - Prove the engine boundary first

Inputs: [engine contracts](engine-contracts.md), exact game 42.20.4 installation,
locked Umbrella reference, a disposable SP save and a dedicated server/two clients.

Build tiny independent probes for E01-E07 and E09: item/tool loading, native action
lifecycle and authority, same-window identity, closed-window read-only preflight,
material bill, rope footprint, smash/attach replication, clearance and permissions.
Test open windows first, then closed windows; failures must not be masked by a mock.
Capture the exact vanilla material/placement behavior rather than reproducing it
from assumptions.

Deliverables: evidence for each probe, a lifecycle/context trace, material/geometry
fixtures, and a concrete mapping from each adapter operation to verified APIs.
Identify the exact candidate gameplay values requiring calibration. No general
capability registry or multi-build adapter framework is needed.

Exit: E01-E07 and E09 PASS for the intended release modes. Any failed execution,
preflight, cost or replication contract stops dependent work. A changed architecture
requires an explicit design revision and updated acceptance tests.

## P1 - Build the pure model and independent tests

Implement plain-data types for TargetAddress, normalized actor/window/world facts,
MaterialBill, DeploymentPlan, Quote and Outcome. Implement deterministic policy,
supercover cell/edge traversal, bounded landing access and a small operation state
machine. No Java userdata, engine globals, I/O or event registration in these modules.

Write table-driven and generated fixtures from D01-D09. Enumerate invalid states,
coordinate boundaries and callback/request orderings. Material-count fixtures must
come from P0 evidence, not a duplicate of the implementation under test. Test
properties as well as example outputs.

Deliverables: new pure test runner, fixtures, reason catalog and module contracts.
Exit: T03-T06, T08-T10 and T13-T18 pass in pure form; all terminal-state and bounded
work properties are demonstrated. These are not runtime compatibility passes.

## P2 - Item, input and action shell with no world mutation

Create the package and tool definition from verified parser/model references.
Preserve public mod/item identity. Add one-time registration, per-player controller,
localization and explicit aim/confirm/floor/candidate controls. Build the shared
timed-action bridge with a no-op authority writer; map admission, cancellation and
completion exactly as established in E03. There must be no fire RPC or alternate
shot loop.

Exercise equip/unequip, text focus, weapon attacks, interrupted actions, death and
world changes. Verify each native callback's role. Rendering and presentation may
observe state but cannot commit it.

Deliverables: independently playable no-op tool, role/ownership assertions and
lifecycle integration tests. Exit: T01, T02, T07, T19, T20 and T28 pass for the shell;
zero inventory or world effects are possible yet.

## P3 - Read-only targeting and authoritative quotes

Implement normalized engine reads, selected-floor candidate detection and canonical
edge resolution. Add conservative corridor/column/landing validation and permission
checks. Build quote/status dispatch with schema/size/rate limits and authenticated
actor binding. Bind quotes to current instances, configuration, exact bill and origin.

Present provisional versus quoted states, exact materials and glass warnings. Bind
responses to request/selection generation so old replies cannot change the current
target. Simulate target replacement, material transfer, chunk unload and configuration
changes. No world writer is wired in this package.

Deliverables: read-only tool preview and quoted DeploymentPlan plus diagnostics.
Exit: T03-T06, T08-T10, T13-T18 and T26 pass with the live read adapter; denied/quoted
requests produce no glass, inventory, rope or world-noise changes.

## P4 - Implement one authoritative deployment path

Implement action admission and final revalidation, one-use quote accounting,
actor/edge/footprint guards, and the engine writer. Keep authority entry guarded
in every runtime mode. Commit open-window deployments first; verify material and
rope postconditions. Add closed-window deployment only with proved non-mutating
preflight and explicit irreversible-failure semantics.

Exercise fault injection before/after each mutating native call and during
postcondition inspection. Record actual deltas. Build quarantine and session-wide
writer disablement for uncertain results. Do not add manual refunds, native object
reconstruction, double resource deduction, or extra replication as trial-and-error
fixes.

Deliverables: complete SP deployment with traceable outcomes, real native climb and
removal, and fault-test harness. Exit: T08-T12, T17-T20 and T22-T25 pass in SP where
applicable; multi-actor cases use the deterministic harness here and are not marked
as real-MP passes. Partial failures are classified and never automatically repeated.

## P5 - Multiplayer, races and recovery evidence

Run dedicated server plus two clients using the same domain/writer path. Exercise
simultaneous shots at the same edge and overlapping rope columns, duplicate action
admission/completion, stale/forged quotes, lost replies, reconnects and disconnects
at each phase. Verify server inventory versus both clients and an observer who
loads the area later. Client callbacks must never mutate the world.

Exercise normal native save/load, stopped-server restart, and inspection of an
injected uncertain outcome. Explicitly keep crash-inside-native-mutation recovery
outside the claimed guarantee. Test protection settings and benign interaction
with ordinary weapons and other actions.

Deliverables: multi-process logs, exact inventory/world comparisons, race/fault
reports and mode-specific support matrix. Exit: T07, T11-T12 and T16-T28 pass in
real MP; no unresolved duplicate, debit, permission or replication fault remains.

## P6 - Presentation, budgets and release candidate

Add verified launch presentation and optional cosmetic line only after P5. Check
model, animation, sound, glass warnings, landing feedback and all translated reasons.
Measure candidate scanning, quote load and cleanup against D09 budgets. Verify Linux
case-sensitive packaging and a cold start with only the intended package enabled.

Document tested controls, inventory scope, target geometry and exact supported game
builds. Advertise controller/local co-op only after their additional tests pass.
Do not label a build playable solely because the pure runner is green.

Deliverables: completed test evidence, known limitations, installation/usage guide,
measured performance report and release checklist. Exit: all required T01-T30 gates
PASS, optional modes explicitly supported or excluded, and every advertised claim
backed by an evidence record.

## Proposed module layout

Names below express the new boundaries; they are not a map of files to repair.
Keep modules small and combine adjacent files if separation adds no value.

```text
Contents/mods/GrappleHook/
  common/media/                         verified shared assets
  42/mod.info
  42/media/scripts/grapplehook_items.txt
  42/media/lua/shared/grapplehook/
    model.lua                           plain data and reason definitions
    policy.lua                          eligibility, bill/plan checks
    geometry.lua                        pure bounded traversal/access
    engine_read.lua                     normalized engine reads
    deploy_action.lua                   shared native action bridge
  42/media/lua/client/grapplehook/
    bootstrap.lua                       idempotent client registration
    controller.lua                      per-player input/selection
    view.lua                            render cached state only
  42/media/lua/server/grapplehook/
    bootstrap.lua                       verified authority guard
    quote_transport.lua                 quote/status messages only
    deployment_service.lua              quotes, lifecycle, ledger, guards
    engine_write.lua                    only world/inventory mutation boundary
```

Logical runtime responsibilities take precedence over folder names. Adapt packaging
to the proven native loader/action registration contract; never infer authority from
`server/` alone. Put fresh tests outside `Contents/`, separate pure, adapter and
real-engine suites, and provide a documented runner with explicit prerequisites.

## Working rules and definition of done

Each implementation commit should identify its P-package, D-contracts and T-tests,
include only one coherent change, and record new engine assumptions. No commit may
silently turn an UNKNOWN into CLEAR, make a client authoritative, or downgrade an
engine gate to a static assertion.

A clean release package contains only the implementation built from this design
and its intended registration points. Verify package contents and cold-start event
counts; two implementations must never be loaded together. This is a packaging
acceptance check, not a request to reuse or migrate runtime internals.

No time estimates are prerequisites. The first executable task is P0, not feature
coding. Completion means demonstrated behavior with independent evidence.
